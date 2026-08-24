const isTrustedMainFrameEvent = (event, expectedWebContents, isUrlAllowed) => Boolean(
  event?.senderFrame
  && expectedWebContents
  && !expectedWebContents.isDestroyed?.()
  && event.sender === expectedWebContents
  && event.senderFrame === expectedWebContents.mainFrame
  && typeof isUrlAllowed === 'function'
  && isUrlAllowed(event.senderFrame.url || event.sender.getURL())
);

const captureFrameOwner = (event) => {
  if (!event?.sender || !event?.senderFrame) return null;
  return Object.freeze({
    webContentsId: event.sender.id,
    processId: event.senderFrame.processId,
    routingId: event.senderFrame.routingId
  });
};

const isFrameOwner = (event, owner) => Boolean(
  owner
  && event?.sender
  && event?.senderFrame
  && event.sender.id === owner.webContentsId
  && event.senderFrame.processId === owner.processId
  && event.senderFrame.routingId === owner.routingId
);

module.exports = {
  captureFrameOwner,
  isFrameOwner,
  isTrustedMainFrameEvent
};
