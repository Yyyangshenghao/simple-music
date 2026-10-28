declare module '*?url' {
  const url: string
  export default url
}

declare module '*?worker&inline' {
  const WorkerConstructor: new () => Worker
  export default WorkerConstructor
}
