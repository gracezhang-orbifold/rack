import { describe, it, expect, beforeAll } from "vitest";
import { resetDb, pool } from "./helpers.js";

describe("migrations + seed", () => {
  beforeAll(resetDb);
  it("creates 28 item types with correct availability", async () => {
    const { rows } = await pool.query(`select count(*)::int n from item_types`);
    expect(rows[0].n).toBe(28);
    const gopro = await pool.query(
      `select available_units::int a from item_availability where name = 'GoPro 13 Black'`);
    expect(gopro.rows[0].a).toBe(3);
  });
  it("borrow_unit claims a unit and enforces the race guard", async () => {
    await pool.query(`insert into profiles (id, email, password_hash) values
      ('99999999-9999-9999-9999-999999999999', 't@t.t', 'x')`);
    const t = await pool.query(`select id from item_types where name = 'Oculus'`);
    const s = await pool.query(`select * from borrow_unit($1, $2, 7)`,
      ["99999999-9999-9999-9999-999999999999", t.rows[0].id]);
    expect(s.rows[0].session_id).toBeTruthy();
    await expect(
      pool.query(`select * from borrow_unit($1, $2, 7)`,
        ["99999999-9999-9999-9999-999999999999", t.rows[0].id]),
    ).rejects.toThrow(/no units available/);
  });
});
