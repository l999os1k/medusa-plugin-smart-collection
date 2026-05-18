import Medusa from "@medusajs/js-sdk";

export const sdk = new Medusa({
	baseUrl: typeof __BACKEND_URL__ !== "undefined" ? __BACKEND_URL__ : "/",
	debug: false,
	auth: {
		type: "session",
	},
});
