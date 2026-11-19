export function orderedNodes<T extends { id: string }>(
  nodes: T[],
  order: string[],
): T[] {
  const remaining = new Map(nodes.map(node => [node.id, node]));
  const result: T[] = [];
  for (const id of order) {
    const node = remaining.get(id);
    if (node) {
      result.push(node);
      remaining.delete(id);
    }
  }
  return result.concat([...remaining.values()]);
}
