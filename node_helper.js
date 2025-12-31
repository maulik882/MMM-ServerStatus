const NodeHelper = require("node_helper");
const ping = require("ping");

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
				// Send results back to the module
				this.sendSocketNotification("MMM-SERVERSTATUS_PINGS_" + group, {
					group: group,
					pingResults: pings
				});
			})
			.catch((error) => {
				console.error("MMM-ServerStatus: Error during pinging:", error);
			});
	},

	async pingHosts(hosts) {
		// Use Promise.all to ping all hosts in parallel for better performance and reliability
		const pingPromises = hosts.map(async (host) => {
			try {
				const pong = await ping.promise.probe(host.ip, { timeout: host.timeout || 1 });
				return {
					...host,
					isAlive: pong.alive,
					pingTime: pong.time,
					fullResults: pong
				};
			} catch (e) {
				console.error(`MMM-ServerStatus: Failed to ping ${host.ip}:`, e);
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
