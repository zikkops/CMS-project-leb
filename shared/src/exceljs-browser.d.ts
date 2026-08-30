// Lives in shared, not in an app: the importer is shared/src/customerManagement.ts,
// so every app that pulls that module in needs this declaration.
// exceljs publishes a self-contained browser bundle separate from its Node
// entry point (see customerManagement.ts's exportCustomersToExcel
// for why it's imported directly instead of the bare 'exceljs' specifier).
// That subpath has no shipped types, so it's declared here as a re-export
// of the main package's types — the runtime export shape is the same.
declare module 'exceljs/dist/exceljs.min.js' {
  export * from 'exceljs'
  export { default } from 'exceljs'
}
