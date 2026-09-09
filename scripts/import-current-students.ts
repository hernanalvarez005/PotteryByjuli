// Imports Pottery's current roster of recurring-class groups/students into
// the existing workshop_programs/workshop_groups/workshop_enrollments
// model, reusing `customers` for every student — never a parallel
// "student" table. See docs/business-rules.md § Importación de datos
// reales and lib/import/students.ts for the mapping rules.
//
// Usage:
//   npx tsx scripts/import-current-students.ts --dry-run [--file=imports/current-students.csv]
//   npx tsx scripts/import-current-students.ts --apply

import { readFileSync } from "node:fs";
import { buildStudentsPlan, parseStudentsCsv, splitStudentName, type GroupPlan } from "../lib/import/students";
import { createAdminClient } from "./_supabase-admin";

const PROGRAM_CODE_MARKER = "Taller de cerámica (importado)"; // matched by name, see note below

function parseArgs(argv: string[]) {
  const apply = argv.includes("--apply");
  const fileArg = argv.find((a) => a.startsWith("--file="));
  return {
    mode: apply ? ("apply" as const) : ("dry-run" as const),
    file: fileArg ? fileArg.slice("--file=".length) : "imports/current-students.csv",
  };
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`\n=== Import alumnas actuales (${args.mode}) ===\n`);

  const csvText = readFileSync(args.file, "utf-8");
  const plan = buildStudentsPlan(parseStudentsCsv(csvText));

  const admin = createAdminClient();

  const [{ data: existingCustomers, error: custErr }, { data: tags, error: tagErr }] = await Promise.all([
    admin.from("customers").select("id, first_name, last_name"),
    admin.from("customer_tags").select("id, code"),
  ]);
  if (custErr) throw custErr;
  if (tagErr) throw tagErr;

  const studentTag = (tags ?? []).find((t) => t.code === "student");
  if (!studentTag) throw new Error('No existe el tag "student" — revisar el seed de Fase 2.');

  const existingByExactName = new Map<string, string>();
  const existingByFirstName = new Map<string, { id: string; fullName: string }[]>();
  for (const c of existingCustomers ?? []) {
    const full = normalizeName(`${c.first_name} ${c.last_name ?? ""}`);
    existingByExactName.set(full, c.id as string);
    const firstKey = normalizeName(c.first_name as string);
    if (!existingByFirstName.has(firstKey)) existingByFirstName.set(firstKey, []);
    existingByFirstName.get(firstKey)!.push({ id: c.id as string, fullName: full });
  }

  const matched: string[] = [];
  const toCreate: string[] = [];
  const potentialConflicts: { name: string; existing: string[] }[] = [];

  for (const name of plan.uniqueStudents) {
    const key = normalizeName(name);
    if (existingByExactName.has(key)) {
      matched.push(name);
      continue;
    }
    toCreate.push(name);
    const { firstName } = splitStudentName(name);
    const sameFirstName = existingByFirstName.get(normalizeName(firstName)) ?? [];
    if (sameFirstName.length > 0) {
      potentialConflicts.push({ name, existing: sameFirstName.map((s) => s.fullName) });
    }
  }

  printDryRunReport(plan, { matched: matched.length, toCreate: toCreate.length, potentialConflicts });

  if (args.mode === "dry-run") {
    console.log("\nDry-run únicamente — no se escribió nada. Ejecutar con --apply para aplicar.\n");
    return;
  }

  // 1) One workshop_programs row to hang every group off — created once,
  // matched by name on re-run since there's no natural external id here.
  const { data: existingProgram, error: progErr } = await admin
    .from("workshop_programs")
    .select("id")
    .eq("name", PROGRAM_CODE_MARKER)
    .maybeSingle();
  if (progErr) throw progErr;

  let programId = existingProgram?.id as string | undefined;
  if (!programId) {
    const { data, error } = await admin
      .from("workshop_programs")
      .insert({ name: PROGRAM_CODE_MARKER, description: "Creado por scripts/import-current-students.ts" })
      .select("id")
      .single();
    if (error) throw error;
    programId = data.id as string;
    console.log(`+ programa: ${PROGRAM_CODE_MARKER}`);
  }

  // 2) Groups — matched by name (unique enough within one program).
  const { data: existingGroups, error: groupsErr } = await admin
    .from("workshop_groups")
    .select("id, name")
    .eq("program_id", programId);
  if (groupsErr) throw groupsErr;
  const groupIdByName = new Map((existingGroups ?? []).map((g) => [g.name as string, g.id as string]));

  const groupIdByCode = new Map<string, string>();
  for (const group of plan.groups) {
    let groupId = groupIdByName.get(group.label);
    if (!groupId) {
      groupId = await createGroup(admin, programId, group);
      console.log(`+ grupo: ${group.label} (capacidad placeholder = ${group.students.length}, ajustar cuando se confirme la real)`);
    }
    groupIdByCode.set(group.code, groupId);
  }

  // 3) Customers — exact-name match only, created with just what's known.
  const customerIdByName = new Map<string, string>(matched.map((name) => [normalizeName(name), existingByExactName.get(normalizeName(name))!]));
  for (const name of toCreate) {
    const { firstName, lastName } = splitStudentName(name);
    const { data, error } = await admin
      .from("customers")
      .insert({ first_name: firstName, last_name: lastName })
      .select("id")
      .single();
    if (error) throw error;
    customerIdByName.set(normalizeName(name), data.id as string);
    console.log(`+ cliente: ${name}`);

    const { error: tagLinkErr } = await admin
      .from("customer_tag_links")
      .insert({ customer_id: data.id, tag_id: studentTag.id });
    if (tagLinkErr) throw tagLinkErr;
  }

  // 4) Enrollments — (group, customer) is already unique in the schema,
  // so a plain insert-if-missing is enough for idempotency.
  const { data: existingEnrollments, error: enrollErr } = await admin
    .from("workshop_enrollments")
    .select("group_id, customer_id");
  if (enrollErr) throw enrollErr;
  const existingEnrollmentKeys = new Set((existingEnrollments ?? []).map((e) => `${e.group_id}:${e.customer_id}`));

  let enrollmentsCreated = 0;
  let enrollmentsSkipped = 0;
  for (const enrollment of plan.enrollments) {
    const groupId = groupIdByCode.get(enrollment.groupCode);
    const customerId = customerIdByName.get(normalizeName(enrollment.studentName));
    if (!groupId || !customerId) {
      console.error(`  ✗ no se pudo resolver grupo/cliente para ${enrollment.studentName} → ${enrollment.groupCode}`);
      continue;
    }
    const key = `${groupId}:${customerId}`;
    if (existingEnrollmentKeys.has(key)) {
      enrollmentsSkipped += 1;
      continue;
    }
    const { error } = await admin.from("workshop_enrollments").insert({ group_id: groupId, customer_id: customerId });
    if (error) throw error;
    existingEnrollmentKeys.add(key);
    enrollmentsCreated += 1;
  }

  console.log("\n=== Resultado de la aplicación ===");
  console.log(`Clientes nuevos:        ${toCreate.length}`);
  console.log(`Clientes ya existentes: ${matched.length}`);
  console.log(`Inscripciones creadas:  ${enrollmentsCreated}`);
  console.log(`Inscripciones ya existentes: ${enrollmentsSkipped}`);
  console.log(
    "\nPendiente (no importado, requiere confirmación humana): Tefi Domínguez → también asiste los martes, " +
      "grupo (1 o 2) sin confirmar. Sólo se importó su inscripción del lunes."
  );
}

async function createGroup(admin: ReturnType<typeof createAdminClient>, programId: string, group: GroupPlan): Promise<string> {
  const { data, error } = await admin
    .from("workshop_groups")
    .insert({
      program_id: programId,
      name: group.label,
      schedule: group.weekday, // free-text label; exact time not yet known
      weekday: group.weekdayIso,
      // start_time/end_time intentionally left null — real schedule not
      // provided yet (docs/business-rules.md § Importación — horarios).
      capacity: group.students.length, // placeholder = current headcount; see report
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

function printDryRunReport(
  plan: ReturnType<typeof buildStudentsPlan>,
  extra: { matched: number; toCreate: number; potentialConflicts: { name: string; existing: string[] }[] }
) {
  console.log("GRUPOS Y ALUMNAS");
  console.log(`  Grupos: ${plan.totals.groups}`);
  plan.groups.forEach((g) => console.log(`    - ${g.label} (${g.weekday}): ${g.students.length} alumnas`));
  console.log(`  Personas únicas: ${plan.totals.uniqueStudents}`);
  console.log(`  Inscripciones conocidas: ${plan.totals.enrollments}`);
  console.log(`  Inscripción adicional pendiente: 1 (Tefi Domínguez → martes, grupo sin confirmar — no se importa)`);

  console.log("\nCLIENTES");
  console.log(`  Existing customers matched (nombre exacto): ${extra.matched}`);
  console.log(`  New customers: ${extra.toCreate}`);
  console.log(`  Potential conflicts (mismo nombre de pila, apellido distinto — no se fusiona, sólo revisar): ${extra.potentialConflicts.length}`);
  extra.potentialConflicts.forEach((c) => console.log(`    - "${c.name}" vs. existente(s): ${c.existing.join(", ")}`));

  console.log("\nCAPACIDAD DE GRUPOS");
  console.log("  Placeholder = cantidad actual de alumnas por grupo (el dato real de cupo máximo no fue provisto).");
  console.log("  Ajustar manualmente en /talleres una vez confirmado el cupo real de cada grupo.");

  console.log("\nHORARIOS");
  console.log(`  ${plan.totals.groups} horarios pendientes de completar (se conoce el día, no el horario exacto).`);
  console.log("  Los grupos alimentarán /calendario recién cuando se cargue start_time.");
}

main().catch((err) => {
  console.error("\nImport falló:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
