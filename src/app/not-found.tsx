import Link from "next/link";

export default function NotFound() {
  return (
    <main className="error-page">
      <h1>This branch hasn’t been written.</h1>
      <Link className="button primary" href="/">
        Return to your stories
      </Link>
    </main>
  );
}
