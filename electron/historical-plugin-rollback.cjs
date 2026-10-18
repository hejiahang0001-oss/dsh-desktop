// Retain the desktop's durable undo only. Ordinary plugin management belongs to Harness.
const createHistoricalPluginRollback = ({ getInstaller, getCatalog, getHealth, resolveProfilePath, isBusy, confirm, restart, getContext }) => {
  let pending = false;
  const inspect = async () => {
    const installer = getInstaller();
    if (!installer) return { targets: [], pnpm: { status: 'unavailable' } };
    const pnpm = await installer.inspectRuntime(), health = await getHealth(), targets = [];
    for (const item of getCatalog()) {
      for (const profileName of item.profiles) {
        const profile = health.profiles?.find(candidate => candidate.name === profileName);
        const profileDir = profile?.id ? await resolveProfilePath(profile.id) : null;
        if (!profileDir) continue;
        // Includes the LKG/current version, enabled state and complete Profile snapshot equality.
        const lifecycle = await installer.inspectLifecycle({ profileDir, catalogId: item.id });
        if (lifecycle.canRollback !== true) continue;
        targets.push({ item, profileDir, profileId: profile.id, profileName,
          canRollback: pnpm.status === 'ready' && health.runtime?.status === 'healthy'
            && profile.status === 'healthy' && profile.workspaceReady === true && lifecycle.status === 'ready' });
      }
    }
    return { targets, pnpm };
  };
  const list = async () => {
    const { targets } = await inspect();
    return { items: targets.map(target => ({ profileId: target.profileId, profileName: target.profileName,
      catalogId: target.item.id, name: target.item.name, displayName: target.item.displayName,
      canRollback: target.canRollback && !pending && !isBusy() })),
    message: '仅回退已有桌面事务。官方或手工修改过 Profile 后，若完整快照不再一致，会拒绝覆盖并保留历史记录。' };
  };
  const run = async ({ profileId, catalogId }) => {
    if (pending || isBusy()) return { ok: false, message: '请先结束当前 Agent、终端、待确认或其他维护任务。' };
    pending = true;
    let transaction, restartAttempted = false;
    const installer = getInstaller();
    try {
      const before = await inspect();
      const target = before.targets.find(item => item.profileId === profileId && item.item.id === catalogId);
      if (!target?.canRollback) return { ok: false, message: '没有可安全回退的历史桌面事务；Profile 或健康状态已变化，历史记录仍保留。' };
      if (isBusy()) return { ok: false, message: '当前运行状态已变化，Profile 未修改。' };
      const context = getContext();
      if (!await confirm({ ...target, pnpm: before.pnpm })) return { ok: false, canceled: true, message: '已取消，Profile 未修改。' };
      if (isBusy()) return { ok: false, message: '确认期间运行状态已变化，Profile 未修改。' };
      const confirmed = await inspect();
      const current = confirmed.targets.find(item => item.profileId === profileId && item.item.id === catalogId);
      if (!current?.canRollback || current.profileDir !== target.profileDir || installer !== getInstaller()
        || getContext().workspacePath !== context.workspacePath || isBusy()) {
        return { ok: false, message: '确认期间历史事务、Profile 或健康状态已变化；没有覆盖，历史记录仍保留。' };
      }
      // The manager rechecks LKG/current snapshots when acquiring its persistent transaction.
      transaction = await installer.rollbackLastKnownGood({ profileDir: current.profileDir, catalogId, ...context });
      if (isBusy()) throw new Error('历史回退期间运行状态发生变化。');
      restartAttempted = true;
      const restarted = await restart();
      if (!restarted.ok) throw new Error(restarted.error || 'Harness 重启失败。');
      const verified = await getHealth(), profile = verified.profiles?.find(item => item.id === profileId);
      const dependency = profile?.dependencies?.find(item => item.name === transaction.plugin.name);
      const targetVerified = transaction.target.version === null ? !dependency
        : dependency?.version === transaction.target.version && dependency.enabled === transaction.target.enabled
          && dependency.compatibility?.status === 'verified';
      if (verified.runtime?.status !== 'healthy' || profile?.status !== 'healthy' || !targetVerified) {
        throw new Error('重启后的插件版本、启用状态或兼容健康结果不一致。');
      }
      await installer.commit(transaction.id);
      return { ok: true, message: '历史桌面事务已回退，Harness 已健康重启；保留最近可用回退点。' };
    } catch (error) {
      let rollbackOk = false, restartOk = false;
      if (transaction?.changed) {
        try {
          await installer.rollback(transaction.id); rollbackOk = true;
          restartOk = restartAttempted ? Boolean((await restart()).ok) : true;
        } catch { /* Persistent journal remains for guarded startup recovery. */ }
      }
      const suffix = error?.code === 'install-rollback-failed'
        ? '未能确认 Profile 已恢复；本次运行已封锁该 Profile，请退出软件并检查记录。'
        : transaction?.changed
          ? rollbackOk
            ? !restartAttempted ? '已恢复回退前 Profile；Harness 未执行重启。'
              : restartOk ? '已恢复回退前 Profile 并重新启动 Harness。' : 'Profile 已恢复，但 Harness 未能重新启动。'
            : '未能确认 Profile 已恢复；持久日志会在下次启动继续处理。'
          : '没有提交历史回退；原有恢复记录仍保留。';
      return { ok: false, message: `${error?.message || '历史桌面事务回退失败。'} ${suffix}` };
    } finally { pending = false; }
  };
  return Object.freeze({ list, run });
};

module.exports = { createHistoricalPluginRollback };
