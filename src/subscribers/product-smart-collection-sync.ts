import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa";
import { smartCollectionProductWorkflow } from "../workflows/smart-collection-sync";

export default async function syncProductSmartCollections({
	event: { data },
	container,
}: SubscriberArgs<{ id: string }>) {
	await smartCollectionProductWorkflow(container).run({
		input: {
			product_id: data.id,
		},
	});
}

export const config: SubscriberConfig = {
	event: ["product.created", "product.updated"],
};
