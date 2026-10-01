// Deletes all candidate attempts (test data only). Candidates, jobs and question sets are kept.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const tables = ["proctorEvent", "answer", "result", "attempt"];
  const counts = {};
  for (const t of tables) {
    if (!prisma[t]) { console.log("Skipping unknown model:", t); continue; }
    counts[t] = (await prisma[t].deleteMany({})).count;
  }
  console.log("Deleted:", counts);
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
