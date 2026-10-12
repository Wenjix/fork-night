-- Original, clearly labeled demonstration starters. No participant data or API expense.
insert into public.pilot_rooms(id, title, description, is_open) values
  ('midnight-signal', 'The midnight signal', 'A lighthouse. A missing keeper. A story we make together.', true),
  ('paper-moon', 'Paper moon', 'Every window shows a different possible tomorrow.', true),
  ('lantern-archive', 'The Lantern Archive', 'A glowing chart remembers a doorway nobody has seen.', true)
on conflict (id) do nothing;

insert into public.pilot_room_capacity(room_id) select id from public.pilot_rooms
on conflict(room_id) do nothing;

insert into public.pilot_moments(id, room_id, maker_label, title, panels, source_kind) values
  ('10000000-0000-4000-8000-000000000001', 'midnight-signal', 'Room starter', 'The midnight signal',
   '[{"imageUrl":"/art/midnight-story.webp#frame=0","caption":"At midnight, the lighthouse blinked for the first time in years."},{"imageUrl":"/art/midnight-story.webp#frame=1","caption":"Mira found a note beneath the lamp: someone out there was waiting."}]', 'fixture'),
  ('10000000-0000-4000-8000-000000000002', 'paper-moon', 'Room starter', 'A moon made of paper',
   '[{"imageUrl":"/art/midnight-story.webp#frame=3","caption":"A paper moon caught in the branches above the street."},{"imageUrl":"/art/midnight-story.webp#frame=4","caption":"Every window below it showed a different possible tomorrow."}]', 'fixture'),
  ('10000000-0000-4000-8000-000000000003', 'lantern-archive', 'Room starter', 'A map keeps its own light',
   '[{"imageUrl":"/art/midnight-story.webp#frame=0","caption":"The last lamp should have gone dark."},{"imageUrl":"/art/midnight-story.webp#frame=1","caption":"One chart kept its own light."}]', 'fixture')
on conflict (id) do nothing;
