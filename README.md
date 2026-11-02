# ZERO Browser

A modern desktop web browser application built with Electron.js, designed as the foundation for a futuristic AI-driven ecosystem called ZERO.

## Features

- **Glassmorphism UI**: Dark, premium interface with frosted glass effects and neon accents.
- **Multi-Tab Browsing**: Seamless tab management with add, switch, and close functionality.
- **Navigation Controls**: Back, forward, and reload buttons.
- **URL Bar**: Centered search/input bar with glowing focus effect.
- **AI Sidebar (Beta)**: Integrated placeholder for the ZERO AI Assistant.
- **Keyboard Shortcuts**:
  - `Ctrl+T` / `Cmd+T`: New tab
  - `Ctrl+W` / `Cmd+W`: Close tab
  - `Ctrl+L` / `Cmd+L`: Focus URL bar
- **Security**: Disabled nodeIntegration, enabled contextIsolation, secure preload bridge.
- **Future-Ready**: Placeholder structures for AI Assistant panel, user login, plugin system, and cybersecurity monitoring.

## Setup Instructions

1. **Initialize the project**:
   ```bash
   npm init -y
   ```

2. **Install Electron**:
   ```bash
   npm install --save-dev electron
   ```

3. **Run the application**:
   ```bash
   npm start
   ```

## Project Structure

```
zero-browser/
├── main.js          # Electron main process
├── preload.js       # Secure bridge for renderer
├── index.html       # Main UI layout
├── styles.css       # Dark theme and animations
├── renderer.js      # Frontend logic and tab management
├── components/      # Future components directory
├── assets/          # Icons and assets directory
└── package.json     # Project configuration
```

## Development

- The browser starts with a custom homepage displaying "Welcome to ZERO".
- Enter URLs in the search bar to navigate to websites.
- Use tabs to manage multiple browsing sessions.
- All security measures are in place to prevent unsafe operations.

## Future Enhancements

- AI Assistant integration
- User authentication system
- Plugin/extension architecture
- Advanced cybersecurity features
- Performance optimizations

## License

MIT# Zero-Browser
