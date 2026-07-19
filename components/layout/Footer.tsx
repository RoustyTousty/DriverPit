export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto w-full max-w-[960px] px-4 py-6 text-center text-xs text-text-muted">
        © {new Date().getFullYear()} DriverPit. Not affiliated with Formula 1, the FIA, or any team.
      </div>
    </footer>
  );
}
