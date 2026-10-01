// pdf-parse's package entry runs debug code on import; the inner file is the safe one to load.
declare module 'pdf-parse/lib/pdf-parse.js' {
  import pdf from 'pdf-parse';
  export default pdf;
}
