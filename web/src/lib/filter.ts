import type { AvailabilityItem } from "./types";

export function filterInventory(items: AvailabilityItem[], q: string): AvailabilityItem[] {
  const term = q.trim().toLowerCase();
  if (!term) return items;
  return items.filter(
    (i) => i.name.toLowerCase().includes(term) || i.category.toLowerCase().includes(term),
  );
}

export function groupByCategory(items: AvailabilityItem[]): [string, AvailabilityItem[]][] {
  const map = new Map<string, AvailabilityItem[]>();
  for (const i of items) map.set(i.category, [...(map.get(i.category) ?? []), i]);
  return [...map.entries()];
}
