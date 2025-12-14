# Shaicoin Mining Pool

This project is a mining pool implementation for Shaicoin. It allows miners to connect and contribute their computing power to the pool, sharing the rewards.

## Prerequisites

- Node.js (v15 or higher)
- C++ compiler (for building the native addon)

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/shaipot-backend.git
   cd shaipot-backend
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Build the native addon:
   ```
   npm run build
   ```

4. Set up MongoDB:
   - For Windows:
     ```
     scripts/start_mongo.ps1
     ```
   - For macOS/Linux:
     ```
     chmod +x scripts/start_mongo.sh
     ./scripts/start_mongo.sh
     ```

5. Configure the pool:
   - Copy `config_example.json` to `config.json`
   - Edit `config.json` with your specific settings

## Running the Pool

1. Start the mining pool server (must have built the addon at least once)
   ```
   node server
   ```

2. The mining pool will be accessible via WebSocket at `ws://localhost:3333` (or the port specified in your configuration).

3. The web UI will be available at `http://localhost:3000`.


## Using `screen` to Monitor the Mining Pool and MongoDB

To effectively manage both the mining pool server and the MongoDB process on the same machine, you can use a tool like `screen`. This utility allows you to run multiple processes in separate sessions and keep them running even after you've logged out.

1. **Start a `screen` session for MongoDB**:
   ```
   screen -S mongodb
   ```
   Inside this session, start MongoDB:
   ```
   ./scripts/start_mongo.sh
   ```

   To detach from the session and leave MongoDB running in the background, press `Ctrl + A` followed by `D`.

2. **Start another `screen` session for the mining pool**:
   ```
   screen -S mining-pool
   ```
   Inside this session, start the mining pool server:
   ```
   node server
   ```

   Again, you can detach from this session by pressing `Ctrl + A` followed by `D`.

3. **Reattach to a `screen` session** if you want to check the logs or status of either process:
   ```
   screen -r mongodb
   ```
   or
   ```
   screen -r mining-pool
   ```

Using `screen` ensures that both MongoDB and the mining pool continue running even if you're not connected to the server, providing an efficient way to monitor both processes in real time.


## Custom Initial Difficulty

You can specify an initial difficulty for your miner by appending a target hex value to the WebSocket URL path. This is useful for low-power devices or specific mining strategies.

Format: `ws://<pool_address>:<port>/<target_prefix>`

Example:
```
./target/release/shaipot -a sh1qs4jvyp5r7ck0xf2ywyhcm3sn3ldzgvupmp0m8a -p ws://127.0.0.1:3333/003ffff 
```
In this example, `003ffff` is the initial target prefix. A larger target value means lower difficulty.
- Default difficulty (if unspecified): ~512 (Target starts with `007fffff...`)
- Minimum difficulty allowed: ~8 (Target starts with `1f...`)

## Troubleshooting

- If you encounter issues with the native addon, ensure you have the necessary build tools installed for your platform.
- For database-related problems, check MongoDB connection settings and ensure the database is running.


## Contributing

Contributions are highly encouraged and valued! We believe in rewarding those who help improve our project. Here's how you can contribute:

Bug Reports: If you discover a meaningful bug, please open an issue with a detailed description. Significant bug reports may be eligible for a reward in Shaicoin from our community wallet.

Thank you for helping make this project better!
