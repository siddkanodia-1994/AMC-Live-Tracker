export function Footer() {
  return (
    <footer className="border-t px-4 py-4 text-center text-xs text-muted-foreground sm:px-6">
      Indian equity prices from DHAN. US-listed holdings priced via{" "}
      <a href="https://finnhub.io" className="underline" target="_blank" rel="noopener noreferrer">
        Finnhub
      </a>
      , converted using exchange rate data from{" "}
      <a href="https://www.exchangerate-api.com" className="underline" target="_blank" rel="noopener noreferrer">
        ExchangeRate-API
      </a>
      .
    </footer>
  );
}
