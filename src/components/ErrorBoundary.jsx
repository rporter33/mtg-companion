import { Component } from 'react'

/**
 * Catches a render error anywhere below it.
 *
 * Without this, one thrown error unmounts the whole tree and leaves a blank
 * page — which is exactly the failure this app hit during development, and the
 * failure that is hardest for a user to report usefully ("it just went white").
 *
 * The fallback deliberately says what still works. This app's decks, guide
 * progress and game state live in storage, not in React state, so a render
 * crash loses nothing — and a user who knows that will reload instead of
 * assuming their decks are gone.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // No telemetry in this app by design, so the console is the only record.
    // Keep the component stack: it is what makes the report actionable.
    console.error('Render error:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="app__main" role="alert">
        <div className="panel stack" style={{ maxWidth: 560, margin: '10vh auto' }}>
          <h1>Something broke on this screen</h1>
          <p className="muted">
            A bug in the interface, not in your data. Your decks, your guide progress and any
            game in progress are stored separately and are intact.
          </p>
          <pre className="mono tiny" style={{
            background: 'var(--bg-input)', padding: 'var(--space-3)',
            borderRadius: 'var(--radius-sm)', overflowX: 'auto', margin: 0,
          }}>
            {String(this.state.error?.message ?? this.state.error)}
          </pre>
          <div className="row">
            <button className="btn btn--primary" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            <button className="btn" onClick={() => window.location.reload()}>
              Reload the app
            </button>
          </div>
          <p className="faint tiny m0">
            If it keeps happening, the full details are in your browser&rsquo;s console.
          </p>
        </div>
      </div>
    )
  }
}
