# lulu 新造型提示记录（2026-10-09）

模式：内置 imagegen；透明背景开启。直接输入为用户提供的图片；视频仅在生成后抽帧核对，不声称模型逐帧读取。最终采用第一次提取图，保留工具原始 alpha。

## 最终采用图的提示

Use case: background-extraction and identity-preserve. Asset type: lulu desktop application mascot and Windows icon source. Image 1 is the exact character reference/edit target supplied by the user. Extract this single full-body yellow 3D cartoon mascot as a clean high-resolution transparent PNG. Preserve its identity and proportions closely: broad orange-yellow muzzle, large friendly eyes, black short spiky flat-top haircut with cropped sides, black browline/half-rim rectangular glasses with thin metal lower rims, small orange fruit with green stem resting on top, orange shorts, smile, the visible hand making a V/peace sign and other hand at the hip. Preserve the same pose, tilt, facial expression, colors, materials and fine hair silhouette, not a redesign. Whole character including fruit, hair, fingers and feet fully visible; centered with a small safe transparent margin. Remove only the garden/house/flowers/grass background, all overlaid Chinese headline, social watermark and account text. Do not reproduce any text, scenery, label, badge, border, ground, cast shadow or checkerboard background. Genuine alpha transparency, crisp natural edges without white/blue halos. Do not turn into a different character or add new accessories.

## 验收边界

AI 辅助提取不保证逐像素一致。放大原尺寸仍有少量边缘残色；验收应看实际界面和小尺寸图标，不宣称无损原图。二次清理试稿没有带来明确改善，未替换已选素材，不继续无边界生成。
