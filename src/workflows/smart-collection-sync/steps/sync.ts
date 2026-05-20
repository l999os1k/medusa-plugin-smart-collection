import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { SMART_COLLECTION_MODULE } from "../../../modules/smart-collection";
import type { SmartCollectionConditions } from "../../../modules/smart-collection/service";
import { ProductDTO } from "@medusajs/framework/types";
import SmartCollectionService from "../../../modules/smart-collection/service";
import { batchLinkProductsToCollectionWorkflow } from "@medusajs/medusa/core-flows";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

export type SyncProductStepInput = {
	product_id?: string;
	collection_ids?: string[];
	products?: ProductDTO[];
	smart_collections?: Array<{
		id: string;
		title: string;
		handle: string;
		metadata: {
			isSmartCollection?: boolean;
			smartCollectionConditions?: SmartCollectionConditions;
		};
		created_at: string;
		updated_at: string;
		deleted_at: string | null;
	}>;
};

export type ProductCollectionMapping = {
	[collectionId: string]: string[]; // Array of product IDs for each collection
};

export type SyncProductStepOutput = {
	success: boolean;
	results: ProductCollectionMapping;
	processedCollections: Array<{
		collectionId: string;
		productCount: number;
	}>;
};

export const syncProductStep = createStep(
	{ name: "sync-product-step" },
	async (input: SyncProductStepInput, { container }) => {
		const smartCollectionService: SmartCollectionService = container.resolve(SMART_COLLECTION_MODULE);
		const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

		const smartCollectionsInput = input.smart_collections || [];

		// Filter collections if specific collection_ids are provided
		const collectionsToProcess = input.collection_ids
			? smartCollectionsInput.filter((col) => input.collection_ids!.includes(col.id))
			: smartCollectionsInput;

		const collectionRules = collectionsToProcess.map((collection) => ({
			collectionId: collection.id,
			conditions: collection.metadata.smartCollectionConditions,
		}));

		let products = input.products || [];

		logger.info(
			`[smart-collection-sync] collections=${collectionsToProcess.length}, products=${products.length}, filtered=${input.collection_ids?.length || 0}, product_id=${input.product_id || "none"}`,
		);

		if (!products.length) {
			logger.warn("[smart-collection-sync] no products available after fetch, skipping processing");
		}

		// Early exit to avoid work when there are no smart collections to process
		if (!collectionsToProcess.length) {
			return new StepResponse<SyncProductStepOutput>({
				success: true,
				results: {},
				processedCollections: [],
			});
		}
		const productCollectionMappings: ProductCollectionMapping = {};

		for (const product of products) {
			for (const collectionRule of collectionRules) {
				const { collectionId, conditions } = collectionRule;
				let isMatch = false;

				try {
					isMatch = smartCollectionService.evaluateConditions(product, conditions);
				} catch (error) {
					logger.warn(
						`[smart-collection-sync] condition evaluation failed for collection=${collectionId}, product=${product.id}`,
					);
					isMatch = false;
				}

				if (isMatch) {
					if (!productCollectionMappings[collectionId]) {
						productCollectionMappings[collectionId] = [];
					}

					productCollectionMappings[collectionId].push(product.id);
				}
			}
		}

		type ProcessedCollection = {
			collectionId: string;
			productCount: number;
		};
		const processedCollections: ProcessedCollection[] = [];

		logger.info(
			`[smart-collection-sync] starting match loop: products=${products.length}, collections=${collectionRules.length}`,
		);

		// Full collection syncs replace evaluated membership.
		// Product event syncs are partial and must only remove evaluated products.
		const isPartialProductSync = Boolean(input.product_id);
		const evaluatedProductIdsSet = new Set(products.map((product) => product.id).filter(Boolean));
		const allEvaluatedCollectionIds = collectionRules.map((rule) => rule.collectionId);

		for (const collectionId of allEvaluatedCollectionIds) {
			const productIds = productCollectionMappings[collectionId] || [];

			try {
				// When updating a collection, we want to replace existing products with matching ones
				// First, we need to get the current products in the collection
				const query = container.resolve("query");
				const { data: currentCollection } = await query.graph({
					entity: "product_collection",
					fields: ["products.id"],
					filters: { id: collectionId },
				});

				const currentProductIds = currentCollection?.[0]?.products?.map((p: any) => p.id) || [];
				const currentProductIdsSet = new Set(currentProductIds);
				const nextProductIdsSet = new Set(productIds);
				const addProductIds = productIds.filter((id) => !currentProductIdsSet.has(id));
				const removeProductIds = isPartialProductSync
					? currentProductIds.filter((id) => evaluatedProductIdsSet.has(id) && !nextProductIdsSet.has(id))
					: currentProductIds.filter((id) => !nextProductIdsSet.has(id));

				if (!addProductIds.length && !removeProductIds.length) {
					processedCollections.push({
						collectionId,
						productCount: productIds.length,
					});
					continue;
				}

				// Use the built-in workflow for linking products to collections
				await batchLinkProductsToCollectionWorkflow(container).run({
					input: {
						id: collectionId,
						add: addProductIds,
						remove: removeProductIds,
					},
				});

				processedCollections.push({
					collectionId,
					productCount: productIds.length,
				});
			} catch (error) {
				logger.error(
					`[smart-collection-sync] failed to update collection ${collectionId}: ${(error as any)?.message}`,
					error,
				);
			}
		}

		logger.info(
			`[smart-collection-sync] finished matching. Collections with products=${Object.keys(productCollectionMappings).length}, processed=${processedCollections.length}`,
		);

		return new StepResponse<SyncProductStepOutput>({
			success: true,
			results: productCollectionMappings,
			processedCollections,
		});
	},
	async (syncOutput: SyncProductStepOutput, { container }) => {
		// Compensation: Could implement rollback logic if needed
		return;
	},
);
