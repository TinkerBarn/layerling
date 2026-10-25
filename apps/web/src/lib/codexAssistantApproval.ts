export function approvalMatches(
  pending: Record<string, unknown> | undefined,
  clientId: string,
  method: string,
  nonce: string,
) {
  return Boolean(
    pending &&
    pending.__layerlingClientId === clientId &&
    pending.__layerlingMethod === method &&
    typeof pending.__layerlingNonce === "string" &&
    pending.__layerlingNonce === nonce,
  );
}
