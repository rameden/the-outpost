// What the page shows when this browser holds no key for the camp (it's new here, its storage was
// cleared, or the camp was started with a new key). Nothing of the camp is on this page.

export function SignIn() {
  return (
    <main className="sign-in" role="main">
      <h1>Satchel</h1>
      <p><b>This browser isn't signed in to the camp.</b></p>
      <p>Open the sign-in link the camp printed in its terminal when it started. A link works once: if it has been used, press <kbd>Enter</kbd> in that terminal for a new one.</p>
      <p className="meta">After you've signed in, this address opens by itself in this browser.</p>
    </main>
  );
}
