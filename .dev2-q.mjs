import { readOnlyQuery } from "./scripts/lib/prod-query.mjs";
const sql = process.argv[2];
console.log(JSON.stringify(await readOnlyQuery(sql), null, 0).replace(/},{/g, "},\n{"));
