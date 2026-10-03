// Serialise an aggregation pipeline to text you can paste into mongosh / Compass.
// Dates become ISODate("..."), so the output is valid mongosh and valid for the Node driver via an ISODate shim.
// One pipeline stage per line keeps it readable and diff-able.
const MARK = "@@ISO@@"; // printable: JSON.stringify would escape a NUL character

function line(value, indent) {
  const text = JSON.stringify(value, function (key, v) {
    const raw = this[key];
    return raw instanceof Date ? `${MARK}ISODate("${raw.toISOString()}")${MARK}` : v;
  }, indent);
  return text.replace(new RegExp(`"${MARK}(.*?)${MARK}"`, "g"), (_, d) => d.replace(/\\"/g, '"'));
}

export function toMongosh(pipeline) {
  return `[\n${pipeline.map((stage) => `  ${line(stage)}`).join(",\n")}\n]`;
}
