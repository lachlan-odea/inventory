/**
 * Shown when .env has no Firebase project id — i.e. someone cloned the repo and
 * ran `npm run dev` before wiring up Firebase. Better than a blank screen and a
 * console error.
 */
export function Setup() {
  return (
    <div className="setup">
      <div className="setup__card">
        <span className="setup__logo" aria-hidden="true">
          📦
        </span>
        <h1>Studio Inventory</h1>
        <p className="muted">One step left — point the app at a Firebase project.</p>

        <ol className="setup__steps">
          <li>
            Create a project at <code>console.firebase.google.com</code>, then add a{' '}
            <strong>Web app</strong> to it.
          </li>
          <li>
            In the console turn on <strong>Firestore Database</strong>, <strong>Storage</strong>, and{' '}
            <strong>Authentication → Email/Password</strong>.
          </li>
          <li>
            Copy <code>.env.example</code> to <code>.env</code> and paste in the web app's config
            values.
          </li>
          <li>
            Restart the dev server: <code>npm run dev</code>
          </li>
        </ol>

        <p className="setup__alt">
          Just want to try it locally? Run <code>npm run emulators</code> in one terminal and{' '}
          <code>npm run dev:emulated</code> in another — no Firebase project needed.
        </p>
      </div>
    </div>
  )
}
