<p align="center">
  <img src="media/icon.png" alt="FTP/SFTP Sync Watcher Logo" width="128" height="128">
</p>

<h1 align="center">FTP/SFTP Sync Watcher</h1>

<p align="center">
  <strong>The most reliable VS Code extension for automatic file synchronization with FTP/SFTP servers</strong>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=ThaLoco0ne.ftp-sync-watcher">
    <img src="https://img.shields.io/visual-studio-marketplace/v/ThaLoco0ne.ftp-sync-watcher?style=flat-square&logo=visual-studio-code&logoColor=white&label=VS%20Code%20Marketplace&color=0078d4" alt="VS Code Marketplace Version">
  </a>
  <a href="https://marketplace.visualstudio.com/items?itemName=ThaLoco0ne.ftp-sync-watcher">
    <img src="https://img.shields.io/visual-studio-marketplace/i/ThaLoco0ne.ftp-sync-watcher?style=flat-square&logo=visual-studio-code&logoColor=white&label=Installs&color=success" alt="VS Code Marketplace Installs">
  </a>
  <a href="https://marketplace.visualstudio.com/items?itemName=ThaLoco0ne.ftp-sync-watcher">
    <img src="https://img.shields.io/visual-studio-marketplace/r/ThaLoco0ne.ftp-sync-watcher?style=flat-square&logo=visual-studio-code&logoColor=white&label=Rating&color=success" alt="VS Code Marketplace Rating">
  </a>
  <a href="https://github.com/LiL-Loco/ftp-sync-watcher/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/LiL-Loco/ftp-sync-watcher?style=flat-square&color=blue" alt="License">
  </a>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#commands">Commands</a> •
  <a href="#troubleshooting">Troubleshooting</a>
</p>

---

## Features

| Feature                       | Description                                                 |
| ----------------------------- | ----------------------------------------------------------- |
| **Upload on Save**            | Automatically upload files when you save them               |
| **File Watcher**              | Monitor file changes and sync automatically in real-time    |
| **Remote Explorer**           | Browse and manage remote files directly in VS Code          |
| **Auto-Delete**               | Optionally delete remote files when local files are deleted |
| **.gitignore Support**        | Automatically respects your `.gitignore` rules              |
| **Custom Ignore Patterns**    | Exclude files and folders with powerful glob patterns       |
| **SSH Key Authentication**    | Secure SFTP connections with private key support            |
| **FTPS / TLS Support**        | Secure FTP connections with certificate and TLS options     |
| **Status Bar Integration**    | Real-time sync status at a glance                           |
| **Smart Reconnection**        | Automatic reconnection with exponential backoff             |
| **Operation Queue**           | Prevents hanging uploads with timeout and retry mechanisms  |
| **Connection Pooling**        | Intelligent connection management to avoid server limits    |

---

## Why This Extension?

Other FTP/SFTP extensions often **stop working** after a while and fail to upload files silently. This extension solves that with:

<table>
<tr>
<td width="50%">

### Robust Architecture

- **Automatic Reconnection** with exponential backoff (up to 5 retries)
- **Operation Timeout** — no more hanging uploads
- **Health Checks** — detects connection issues proactively
- **Global Connection Limiting** — respects server connection limits

</td>
<td width="50%">

### Smart Queue System

- **Non-blocking Queue** — uploads are processed in sequence
- **Retry Mechanism** — failed uploads are retried automatically
- **Rate Limit Handling** — waits intelligently when server is busy
- **Priority System** — important operations first

</td>
</tr>
</table>

---

## Installation

### From VS Code Marketplace (Recommended)

1. Open VS Code
2. Press `Ctrl+P` (or `Cmd+P` on Mac)
3. Type: `ext install ThaLoco0ne.ftp-sync-watcher`
4. Press Enter

### Manual Installation

1. Download the `.vsix` file from [Releases](https://github.com/LiL-Loco/ftp-sync-watcher/releases)
2. In VS Code: `Extensions` → `...` → `Install from VSIX...`

---

## Configuration

Create a `.ftpsync.json` file in your `.vscode` folder. The extension will guide you through this process.

### Quick Start

Press `Ctrl+Shift+P` → `FTP Sync: Create Configuration File`

### SFTP Configuration (Recommended)

```json
{
  "name": "Production Server",
  "protocol": "sftp",
  "host": "example.com",
  "port": 22,
  "username": "deploy",
  "privateKeyPath": "~/.ssh/id_rsa",
  "remotePath": "/var/www/html",
  "localPath": "..",
  "uploadOnSave": true,
  "watcher": {
    "enabled": true,
    "files": "**/*",
    "autoUpload": true,
    "autoDelete": false
  },
  "ignore": [".git", ".vscode", "node_modules"],
  "useGitIgnore": true
}
```

### FTP Configuration

```json
{
  "name": "FTP Server",
  "protocol": "ftp",
  "host": "ftp.example.com",
  "port": 21,
  "username": "ftpuser",
  "password": "your-password",
  "remotePath": "/public_html",
  "secure": true,
  "uploadOnSave": true
}
```

### FTPS with Custom TLS Options

```json
{
  "name": "Secure FTP Server",
  "protocol": "ftp",
  "host": "ftp.example.com",
  "port": 21,
  "username": "ftpuser",
  "password": "your-password",
  "remotePath": "/public_html",
  "secure": true,
  "secureOptions": {
    "rejectUnauthorized": true,
    "caPath": ".certs/ca.pem",
    "certPath": ".certs/client-cert.pem",
    "keyPath": ".certs/client-key.pem",
    "minVersion": "TLSv1.2",
    "maxVersion": "TLSv1.3"
  },
  "uploadOnSave": true
}
```

### FTPS with Self-Signed Certificate

```json
{
  "name": "Legacy FTPS Server",
  "protocol": "ftp",
  "host": "ftp.example.com",
  "port": 21,
  "username": "ftpuser",
  "password": "your-password",
  "remotePath": "/public_html",
  "secure": true,
  "secureOptions": {
    "rejectUnauthorized": false
  }
}
```

### Configuration Reference

<details>
<summary><strong>Click to expand full configuration options</strong></summary>

| Option               | Type                | Default              | Description                              |
| -------------------- | ------------------- | -------------------- | ---------------------------------------- |
| `name`               | string              | -                    | Display name for this connection profile |
| `protocol`           | `"ftp"` \| `"sftp"` | `"sftp"`             | Connection protocol                      |
| `host`               | string              | **required**         | Hostname or IP address                   |
| `port`               | number              | 22 (SFTP) / 21 (FTP) | Port number                              |
| `username`           | string              | **required**         | Username for authentication              |
| `password`           | string              | -                    | Password (not recommended for SFTP)      |
| `privateKeyPath`     | string              | -                    | Path to SSH private key file             |
| `passphrase`         | string              | -                    | Passphrase for encrypted private key     |
| `remotePath`         | string              | **required**         | Remote directory path                    |
| `localPath`          | string              | `"."`                | Local directory relative to workspace    |
| `uploadOnSave`       | boolean             | `true`               | Auto-upload on file save                 |
| `watcher.enabled`    | boolean             | `true`               | Enable file watcher                      |
| `watcher.files`      | string \| false     | `"**/*"`             | Glob pattern for watched files           |
| `watcher.autoUpload` | boolean             | `true`               | Auto-upload changed files                |
| `watcher.autoDelete` | boolean             | `false`              | Delete remote files when local deleted   |
| `ignore`             | string[]            | `[...]`              | Glob patterns to exclude                 |
| `useGitIgnore`       | boolean             | `true`               | Apply .gitignore rules                   |
| `secure`             | boolean             | `false`              | Use FTPS (FTP over TLS) for FTP only     |
| `secureOptions.rejectUnauthorized` | boolean | `true` | Reject self-signed or invalid certificates |
| `secureOptions.caPath` | string            | -                    | Path to a trusted CA certificate         |
| `secureOptions.certPath` | string          | -                    | Path to a client certificate             |
| `secureOptions.keyPath` | string           | -                    | Path to a client private key             |
| `secureOptions.passphrase` | string        | -                    | Passphrase for encrypted TLS private key |
| `secureOptions.minVersion` | string        | -                    | Minimum TLS version (`TLSv1.2`/`TLSv1.3`) |
| `secureOptions.maxVersion` | string        | -                    | Maximum TLS version (`TLSv1.2`/`TLSv1.3`) |
| `secureOptions.ciphers` | string          | -                    | OpenSSL cipher list                      |
| `secureOptions.servername` | string       | -                    | Override TLS server name (SNI)           |
| `secureOptions.secureProtocol` | string   | -                    | Explicit Node.js TLS protocol override   |
| `timeout`            | number              | `30000`              | Connection timeout in ms                 |
| `debug`              | boolean             | `false`              | Enable debug logging                     |

</details>

---

## Commands

Access all commands via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command                               | Description              |
| ------------------------------------- | ------------------------ |
| `FTP Sync: Upload Current File`       | Upload the active file   |
| `FTP Sync: Upload Folder`             | Upload an entire folder  |
| `FTP Sync: Download Current File`     | Download the active file |
| `FTP Sync: Start Watcher`             | Start the file watcher   |
| `FTP Sync: Stop Watcher`              | Stop the file watcher    |
| `FTP Sync: Toggle Watcher`            | Toggle watcher on/off    |
| `FTP Sync: Connect to Server`         | Connect to remote server |
| `FTP Sync: Disconnect`                | Disconnect from server   |
| `FTP Sync: Create Configuration File` | Create a new config file |
| `FTP Sync: Show Output Channel`       | Show logs                |

---

## Remote Explorer

Browse and manage your remote files directly in VS Code:

<table>
<tr>
<td>

### Features

- **Tree View** — Navigate your remote file structure
- **Download** — Download files with one click
- **Delete** — Remove remote files
- **Refresh** — Update the file list

</td>
<td>

### Access

1. Click the **FTP Sync** icon in the Activity Bar
2. Click **Connect** to connect to your server
3. Browse and manage your files!

</td>
</tr>
</table>

---

## Status Bar

The status bar shows the current state:

| Status         | Description                               |
| -------------- | ----------------------------------------- |
| **FTP Sync**   | Watcher inactive — click to start         |
| **Watching**   | Watcher active — click to stop            |
| **Syncing...** | Upload in progress                        |
| **Error**      | Error occurred — check output for details |

---

## Glob Patterns

### Ignore Patterns

```json
{
  "ignore": [
    ".git", // Ignore .git folder
    ".vscode", // Ignore .vscode folder
    "node_modules", // Ignore node_modules
    "*.log", // Ignore all .log files
    "**/*.map", // Ignore all .map files in any folder
    "dist/**", // Ignore everything in dist folder
    "!dist/index.html", // Except dist/index.html
    "temp*", // Ignore files/folders starting with temp
    "**/.DS_Store" // Ignore all .DS_Store files
  ]
}
```

### Watch Patterns

```json
{
  "watcher": {
    "files": "src/**/*.{ts,js,css,html}",
    "autoUpload": true,
    "autoDelete": false
  }
}
```

| Pattern        | Description              |
| -------------- | ------------------------ |
| `**/*`         | All files in all folders |
| `src/**`       | All files in src folder  |
| `*.js`         | All JS files in root     |
| `**/*.{js,ts}` | All JS and TS files      |

---

## Security Best Practices

> **Important Security Recommendations**

1. **Use SSH Keys** — Prefer `privateKeyPath` over `password` for SFTP
2. **Use `rejectUnauthorized: true`** — Only disable certificate validation for self-signed FTPS servers you explicitly trust
3. **Protect Config Files** — Add `.ftpsync.json` to `.gitignore` if it contains sensitive data
4. **Use Environment Variables** — Consider using passphrase-protected keys
5. **Limit Permissions** — Use the minimum required server permissions

> Note: `secure` and `secureOptions` only apply to FTP/FTPS. SFTP is already encrypted via SSH and uses `privateKeyPath` / `passphrase` instead.

---

## Troubleshooting

<details>
<summary><strong>Connection Issues</strong></summary>

1. Verify host, port, and credentials
2. Ensure the server is reachable
3. Enable `"debug": true` for detailed logs
4. Check the Output Channel: `FTP Sync: Show Output Channel`
5. For FTP: Try enabling `"secure": true` for FTPS
6. For self-signed FTPS servers: either provide `secureOptions.caPath` or temporarily set `secureOptions.rejectUnauthorized` to `false`

</details>

<details>
<summary><strong>Files Not Uploading</strong></summary>

1. Check the `ignore` patterns
2. Ensure `uploadOnSave` is enabled
3. Verify the file isn't excluded by `.gitignore`
4. Check the Output Channel for errors

</details>

<details>
<summary><strong>SSH Key Issues</strong></summary>

1. Ensure the key is in OpenSSH format
2. Check file permissions of the private key
3. For encrypted keys: provide the `passphrase`
4. Try converting the key: `ssh-keygen -p -m PEM -f ~/.ssh/id_rsa`

</details>

<details>
<summary><strong>Max Connections Error (530)</strong></summary>

This extension handles this automatically by:

1. Limiting concurrent connections (max 2)
2. Waiting 60 seconds when server rejects connections
3. Queuing operations and processing sequentially

If you still see this error, wait a few minutes for old connections to close.

</details>

---

## Contributing

Contributions are welcome. Please feel free to submit a [Pull Request](https://github.com/LiL-Loco/ftp-sync-watcher/pulls).

### Found a Bug?

Please [open an issue](https://github.com/LiL-Loco/ftp-sync-watcher/issues/new) with:

- Your VS Code version
- Extension version
- Steps to reproduce
- Error messages from the Output Channel

---

## License

This project is licensed under the [MIT License](LICENSE).

---

<p align="center">
  Made by <a href="https://github.com/LiL-Loco">LiL-Loco</a>
</p>

<p align="center">
  <a href="https://github.com/LiL-Loco/ftp-sync-watcher/issues">Report Bug</a> •
  <a href="https://github.com/LiL-Loco/ftp-sync-watcher/issues">Request Feature</a>
</p>
