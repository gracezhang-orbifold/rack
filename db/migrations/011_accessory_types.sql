-- Camera accessory kits: an item type may link to another type whose units
-- are offered as an opt-in companion at borrow time ("also take an accessory
-- kit"). The link is type-level — any available kit unit pairs with any
-- camera of the linked type — and the companion loan is an ordinary,
-- independent borrow_sessions row.

alter table public.item_types
  add column accessory_type_id uuid references public.item_types(id);

alter table public.item_types
  add constraint item_types_no_self_accessory check (accessory_type_id <> id);
