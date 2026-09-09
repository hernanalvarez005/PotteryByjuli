import { describe, it, expect } from "vitest";
import { parseDelimitedText, parseDelimitedRecords } from "./csv";

describe("parseDelimitedText", () => {
  it("splits simple semicolon-delimited rows", () => {
    const rows = parseDelimitedText("a;b;c\n1;2;3", ";");
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("keeps a delimiter that's inside quotes as part of the field", () => {
    const rows = parseDelimitedText('a;b\n"1;1";2', ";");
    expect(rows).toEqual([
      ["a", "b"],
      ["1;1", "2"],
    ]);
  });

  it("keeps a literal newline inside a quoted field as one row, not two", () => {
    const rows = parseDelimitedText('a;b\n"line one\nline two";2', ";");
    expect(rows).toEqual([
      ["a", "b"],
      ["line one\nline two", "2"],
    ]);
  });

  it("unescapes a doubled quote into a literal quote", () => {
    const rows = parseDelimitedText('a\n"she said ""hi"""', ";");
    expect(rows).toEqual([["a"], ['she said "hi"']]);
  });

  it("drops a trailing blank line", () => {
    const rows = parseDelimitedText("a;b\n1;2\n", ";");
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseDelimitedRecords", () => {
  it("maps each row to the header", () => {
    const records = parseDelimitedRecords("Nombre;Precio\nTaza;100", ";");
    expect(records).toEqual([{ Nombre: "Taza", Precio: "100" }]);
  });

  it("fills a missing trailing column with an empty string", () => {
    const records = parseDelimitedRecords("Nombre;Precio\nTaza", ";");
    expect(records).toEqual([{ Nombre: "Taza", Precio: "" }]);
  });
});
