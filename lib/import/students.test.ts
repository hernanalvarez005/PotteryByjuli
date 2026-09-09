import { describe, it, expect } from "vitest";
import { parseStudentsCsv, buildStudentsPlan, splitStudentName } from "./students";

const SAMPLE_CSV = [
  "Grupo;Día;Alumna",
  "Lunes — Grupo 1;Lunes;Estefi Cicarelli",
  "Lunes — Grupo 1;Lunes;Tefi Domínguez",
  "Martes — Grupo 1;Martes;Cami Pagella",
  "Miércoles — Grupo 2;Miércoles;Cami Frigerio",
].join("\n");

describe("parseStudentsCsv", () => {
  it("parses group/weekday/name rows", () => {
    const rows = parseStudentsCsv(SAMPLE_CSV);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({ group: "Lunes — Grupo 1", weekday: "Lunes", name: "Estefi Cicarelli" });
  });
});

describe("buildStudentsPlan", () => {
  it("groups students under their group and derives the ISO weekday", () => {
    const plan = buildStudentsPlan(parseStudentsCsv(SAMPLE_CSV));
    expect(plan.totals.groups).toBe(3);
    const lunes1 = plan.groups.find((g) => g.label === "Lunes — Grupo 1")!;
    expect(lunes1.weekdayIso).toBe(1);
    expect(lunes1.students).toEqual(["Estefi Cicarelli", "Tefi Domínguez"]);
  });

  it("never merges two different people just because their first name matches", () => {
    const plan = buildStudentsPlan(parseStudentsCsv(SAMPLE_CSV));
    expect(plan.uniqueStudents).toContain("Cami Pagella");
    expect(plan.uniqueStudents).toContain("Cami Frigerio");
    expect(plan.totals.uniqueStudents).toBe(4);
  });

  it("counts one enrollment per (student, group) row", () => {
    const plan = buildStudentsPlan(parseStudentsCsv(SAMPLE_CSV));
    expect(plan.totals.enrollments).toBe(4);
  });

  it("gives every group a distinct, stable code", () => {
    const plan = buildStudentsPlan(parseStudentsCsv(SAMPLE_CSV));
    const codes = plan.groups.map((g) => g.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain("lunes-grupo-1");
  });
});

describe("splitStudentName", () => {
  it("splits a two-word name into first/last", () => {
    expect(splitStudentName("María Gómez")).toEqual({ firstName: "María", lastName: "Gómez" });
  });

  it("keeps a compound last name together", () => {
    expect(splitStudentName("Tefi Domínguez")).toEqual({ firstName: "Tefi", lastName: "Domínguez" });
  });

  it("leaves a single-word name with no last name, instead of inventing one", () => {
    expect(splitStudentName("Martina")).toEqual({ firstName: "Martina", lastName: null });
  });
});
