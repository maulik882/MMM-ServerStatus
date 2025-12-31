const NodeHelper = require("node_helper");
const ping = require("ping");
const net = require("net");

module.exports = NodeHelper.create({
	start: function () {
		console.log("MMM-ServerStatus: Ping helper started.");
	},

	socketNotificationReceived: function (notification, data) {
		if (notification === "MMM-SERVERSTATUS_GET_PINGS") {
			this.getPings(data.group, data.hosts);
		}
	},

	getPings(group, hosts) {
		this.pingHosts(hosts)
			.then((pings) => {
				this.sendSocketNotification("MMM-SERVERSTATUS_PINGS_" + group, {
					group: group,
					pingResults: pings
				});
			})
			.catch((error) => {
				console.error("MMM-ServerStatus: Error during pinging:", error);
			});
	},

	// TCP Ping function using native net module (no system binary required)
	tcpPing(ip, port, timeout) {
		return new Promise((resolve) => {
			const socket = new net.Socket();
			const startTime = Date.now();
			let resolved = false;

			const timer = setTimeout(() => {
				if (!resolved) {
					resolved = true;
					socket.destroy();
					resolve({ alive: false, time: "timeout" });
				}
			}, timeout * 1000);

			socket.on("connect", () => {
				if (!resolved) {
					resolved = true;
					clearTimeout(timer);
					const time = Date.now() - startTime;
					socket.destroy();
					resolve({ alive: true, time });
				}
			});

			socket.on("error", (err) => {
				if (!resolved) {
					resolved = true;
					clearTimeout(timer);
					socket.destroy();
					// If connection is refused, the host is actually ALIVE but the port is closed.
					// This is still a valid "up" status for many devices.
					if (err.code === "ECONNREFUSED") {
						resolve({ alive: true, time: Date.now() - startTime });
					} else {
						resolve({ alive: false, time: "unknown" });
					}
				}
			});

			socket.connect(port, ip);
		});
	},

	async pingHosts(hosts) {
		const pingPromises = hosts.map(async (host) => {
			// Determine if we should use TCP or ICMP
			// If a port is specified, or if we know ICMP might fail (optional logic)
			const useTCP = host.port || host.type === "tcp";
			const timeout = host.timeout || 1;

			try {
				if (useTCP) {
					const port = host.port || 80;
					const result = await this.tcpPing(host.ip, port, timeout);
					return {
						...host,
						isAlive: result.alive,
						pingTime: result.time,
						fullResults: result
					};
				} else {
					// Traditional ICMP Ping
					try {
						const pong = await ping.promise.probe(host.ip, { timeout: timeout });
						return {
							...host,
							isAlive: pong.alive,
							pingTime: pong.time,
							fullResults: pong
						};
					} catch (icmpError) {
						// Fallback to TCP on port 80 if ICMP binary is missing
						if (icmpError.message.includes("error while executing the ping program")) {
							if (!this.silencedHosts) this.silencedHosts = new Set();
							if (!this.silencedHosts.has(host.ip)) {
								console.log(`MMM-ServerStatus: ICMP ping binary missing. Falling back to TCP port 80 for ${host.ip} (will silence future logs for this host).`);
								this.silencedHosts.add(host.ip);
							}
							const result = await this.tcpPing(host.ip, 80, timeout);
							return {
								...host,
								isAlive: result.alive,
								pingTime: result.time,
								fullResults: result
							};
						}
						throw icmpError;
					}
				}
			} catch (e) {
				console.error(`MMM-ServerStatus: Failed to check ${host.ip}:`, e);
				return {
					...host,
					isAlive: false,
					pingTime: "unknown",
					fullResults: null
				};
			}
		});

		return await Promise.all(pingPromises);
	},
});

