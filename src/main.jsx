import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Error Boundary to catch crashes and display error instead of white screen
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ error, errorInfo })
    console.error('App crashed:', error)
    console.error('Component stack:', errorInfo?.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-red-50 flex items-center justify-center p-8">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                <span className="text-red-600 text-2xl">!</span>
              </div>
              <h1 className="text-2xl font-bold text-gray-800">Something went wrong</h1>
            </div>

            <p className="text-gray-600 mb-4">
              The app encountered an error. This information can help debug the issue:
            </p>

            <div className="bg-gray-100 rounded-lg p-4 mb-6 overflow-auto max-h-64">
              <p className="font-mono text-sm text-red-700 whitespace-pre-wrap">
                {this.state.error?.toString()}
              </p>
              {this.state.errorInfo?.componentStack && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-gray-600 text-sm">Component Stack</summary>
                  <pre className="text-xs text-gray-500 mt-2 whitespace-pre-wrap">
                    {this.state.errorInfo.componentStack}
                  </pre>
                </details>
              )}
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => window.location.reload()}
                className="py-2 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg"
              >
                Reload App
              </button>
              <button
                onClick={() => {
                  // Clear state and try to recover
                  this.setState({ hasError: false, error: null, errorInfo: null })
                }}
                className="py-2 px-6 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
