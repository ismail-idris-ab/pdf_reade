// Side-effect CSS imports are compiled by NativeWind's Metro transformer.
declare module '*.css';

// Drizzle migration files, inlined as strings by babel-plugin-inline-import.
declare module '*.sql' {
  const content: string;
  export default content;
}
