import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa";
import { smartCollectionWorkflow } from "../workflows/smart-collection-sync";

export default async function updateSmartCollection({ event: { data }, container }: SubscriberArgs<{ id: string }>) {
	await smartCollectionWorkflow(container).run({
		input: {
			collection_id: data.id,
		},
	});
}

export const config: SubscriberConfig = {
	event: ["product_collection.updated"],
};
