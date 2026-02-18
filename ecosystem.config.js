module.exports = {
    apps: [{
        name: "claw-dashboard-2",
        script: "./server.js",
        watch: false,
        ignore_watch: ["node_modules", "logs"],
        out_file: "./logs/out.log",
        error_file: "./logs/error.log",
        merge_logs: true,
        time: true,
        env: {
            NODE_ENV: "production",
            PORT: 3002
        }
    }]
};
