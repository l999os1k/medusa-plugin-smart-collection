import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { syncProductStep, SyncProductStepInput } from "./steps/sync";
import { getProductsStep } from "@medusajs/medusa/core-flows";
import {
	normalizeConditionExpression,
	type ConditionExpressionNode,
	type Rule,
	type SmartCollectionConditions,
} from "../../modules/smart-collection/service";

export type SmartCollectionProductWorkflowInput = SyncProductStepInput;

const listAllSmartCollectionsStep = createStep("list-all-collections", async (_, { container }) => {
	const productModuleService = container.resolve(Modules.PRODUCT);
	const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

	// Get total count first
	const [, totalCount] = await productModuleService.listAndCountProductCollections();

	// Fetch all collections and filter by smart flag locally to handle boolean/string/number values
	const allCollections = await productModuleService.listProductCollections(
		{},
		{
			take: totalCount, // Take all collections
			skip: 0,
		},
	);

	const smartCollections = allCollections.filter((collection) => {
		const flag = collection.metadata?.isSmartCollection;
		return flag === true || flag === "true" || flag === 1 || flag === "1";
	});

	logger.info(
		`[smart-collection-sync] detected ${smartCollections.length} smart collections (total collections: ${allCollections.length})`,
	);

	return new StepResponse(smartCollections);
});

const listAllPublishedProductsStep = createStep("list-all-published-products", async (_, { container }) => {
	const productModuleService = container.resolve(Modules.PRODUCT);
	const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

	logger.info("[smart-collection-sync] listAllPublishedProductsStep start");
	const PAGE_SIZE = 500;
	const products: any[] = [];

	const [, totalCount] = await productModuleService.listAndCountProducts({ status: "published" });
	logger.info(`[smart-collection-sync] expecting totalCount=${totalCount} published products`);

	let offset = 0;
	while (offset < totalCount) {
		const batch = await productModuleService.listProducts(
			{
				status: "published",
			},
			{
				take: PAGE_SIZE,
				skip: offset,
			},
		);

		products.push(...batch);
		offset += batch.length;

		logger.info(
			`[smart-collection-sync] fetched batch size=${batch.length}, accumulated=${products.length}/${totalCount}, offset=${offset}`,
		);

		if (!batch.length) {
			logger.warn("[smart-collection-sync] received empty batch before reaching totalCount, stopping early");
			break;
		}
	}

	logger.info(
		`[smart-collection-sync] fetched ${products.length} published products for sync (totalCount=${totalCount})`,
	);

	return new StepResponse(products);
});

const getFilteredProductsStep = createStep(
	"get-filtered-products",
	async (input: { collectionId: string }, { container }) => {
		const productModuleService = container.resolve(Modules.PRODUCT);

		// First get the collection to access its rules
		const [collection] = await productModuleService.listProductCollections({
			id: input.collectionId,
		});

		if (!collection || !collection.metadata?.smartCollectionConditions) {
			// If no smart collection conditions, return empty array
			return new StepResponse([]);
		}

		const conditions = collection.metadata.smartCollectionConditions as SmartCollectionConditions;
		const expression = normalizeConditionExpression(conditions);
		const allRules: Rule[] = [];

		const collectRules = (node: ConditionExpressionNode) => {
			if (node.kind === "rule") {
				allRules.push(node.rule);
				return;
			}

			node.children.forEach(collectRules);
		};

		if (expression) {
			collectRules(expression);
		}

		// Build query filters based on rules
		const filters: any = {};
		const titleFilters: string[] = [];

		for (const rule of allRules) {
			if (rule.field === "title") {
				// For title field, we can use q parameter for text search
				if (rule.operator === "contains" || rule.operator === "starts_with" || rule.operator === "ends_with") {
					titleFilters.push(rule.value);
				}
			}
		}

		// Only pre-filter if we have meaningful filters
		// Otherwise, get all products to evaluate them properly
		let products;

		if (titleFilters.length > 0 && allRules.length === 1) {
			// Only use pre-filter if we have a single title rule
			// This ensures we don't miss products when there are multiple complex rules
			filters.q = titleFilters[0];
			products = await productModuleService.listProducts(filters, { take: null });
		} else {
			// For complex rules or non-title rules, get all products
			// The actual filtering will happen in syncProductStep
			products = await productModuleService.listProducts({}, { take: null });
		}

		return new StepResponse(products);
	},
);

export const smartCollectionWorkflow = createWorkflow(
	{ name: "smart-collection", retentionTime: 10000 },
	(input: { collection_id: string }) => {
		// Get filtered products based on collection rules for better performance
		const products = getFilteredProductsStep({ collectionId: input.collection_id });

		// Get the specific collection that was updated
		const smart_collections = listAllSmartCollectionsStep();

		// Sync products with the updated collection
		const smartCollectionResult = syncProductStep({
			collection_ids: [input.collection_id],
			products: products,
			smart_collections: smart_collections as any,
		});

		return new WorkflowResponse({
			success: true,
			collectionId: input.collection_id,
			processedCollections: smartCollectionResult.processedCollections,
		});
	},
);

export const smartCollectionProductWorkflow = createWorkflow(
	{ name: "smart-collection-product", retentionTime: 10000 },
	(input: SmartCollectionProductWorkflowInput) => {
		const products = input.products
			? input.products
			: input.product_id
				? getProductsStep({ ids: [input.product_id] })
				: listAllPublishedProductsStep();

		const smart_collections = listAllSmartCollectionsStep();

		const smartCollectionResult = syncProductStep({
			collection_ids: input.collection_ids,
			product_id: input.product_id,
			products: products,
			smart_collections: smart_collections as any,
		});

		// Return the workflow response with the processed collections from the sync step
		return new WorkflowResponse({
			success: true,
			processedCollections: smartCollectionResult.processedCollections,
		});
	},
);
