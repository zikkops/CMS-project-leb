// exceljs publishes a self-contained browser bundle separate from its Node
// entry point (see app/lib/customerManagement.ts's exportCustomersToExcel
// for why it's imported directly instead of the bare 'exceljs' specifier).
// That subpath has no shipped types, so it's declared here as a re-export
// of the main package's types — the runtime export shape is the same.
declare module 'exceljs/dist/exceljs.min.js' {
  export * from 'exceljs'
  export { default } from 'exceljs'
}
