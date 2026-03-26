const clients = new Map(); // workflowId -> Set<res>

export function addClient(workflowId, res) {
  const key = String(workflowId); // normalize to string
  if (!clients.has(key)) clients.set(key, new Set());
  clients.get(key).add(res);
  res.on('close', () => clients.get(key)?.delete(res));
}

export function broadcast(workflowId, event, data) {
  const key = String(workflowId); // normalize to string
  const set = clients.get(key);
  if (!set) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(msg);
}
