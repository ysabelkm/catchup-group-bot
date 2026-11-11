-- Data fix: notes saved before 11 Nov 2026 could be titled "ICT 415 – ICT415" or "COS 411 – "
-- (the course code repeated, or nothing after it). New notes are titled "ICT 415 – Notes".
UPDATE "Item"
SET "title" = "courseCode" || ' – Notes'
WHERE "type" = 'note'
  AND "courseCode" IS NOT NULL
  AND (
    btrim("title") = "courseCode" || ' –'
    OR upper(replace("title", ' ', '')) = upper(replace("courseCode", ' ', '') || '–' || replace("courseCode", ' ', ''))
  );
