import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { SmartCollectionMetadata } from "../../../../modules/smart-collection/service";
import { Modules } from "@medusajs/framework/utils";
import { smartCollectionWorkflow } from "../../../../workflows/smart-collection-sync";
import { batchLinkProductsToCollectionWorkflow } from "@medusajs/medusa/core-flows";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
	const { collectionId } = req.params;

	if (!collectionId) {
		return res.status(400).json({
			message: "Collection ID is required",
		});
	}

	// 使用 Modules.PRODUCT 獲取產品模塊實例
	const productModule = req.scope.resolve(Modules.PRODUCT);

	try {
		// 使用產品模塊的方法獲取 collection
		const collection = await productModule.retrieveProductCollection(collectionId);

		// 創建默認元數據
		const defaultMetadata: SmartCollectionMetadata = {
			isSmartCollection: false,
			smartCollectionConditions: {
				expression: null,
			},
		};

		// 安全地檢查和轉換 metadata
		let metadata: SmartCollectionMetadata = defaultMetadata;

		if (collection.metadata) {
			try {
				const collectionMetadata = collection.metadata as Record<string, unknown>;
				if (collectionMetadata.isSmartCollection !== undefined) {
					metadata = collectionMetadata as unknown as SmartCollectionMetadata;
				}
			} catch (err) {
				// 如果轉換失敗，使用默認值
				console.error("Failed to parse collection metadata", err);
			}
		}

		res.json(metadata);
	} catch (error) {
		console.error("Error retrieving collection:", error);
		res.status(404).json({
			message: error.message || "Collection not found",
		});
	}
};

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
	const { collectionId } = req.params;

	if (!collectionId) {
		return res.status(400).json({
			message: "Collection ID is required",
		});
	}

	try {
		// 確保正確處理請求體
		let bodyData: any = req.body;

		// 處理可能的字符串轉換問題
		if (typeof bodyData === "string") {
			try {
				bodyData = JSON.parse(bodyData);
			} catch (e) {
				console.error("Failed to parse request body string:", e);
				return res.status(400).json({
					message: "Invalid request body format",
					error: e.message,
				});
			}
		}

		// 確保數據結構正確
		const { isSmartCollection, smartCollectionConditions } = bodyData as SmartCollectionMetadata;

		if (isSmartCollection === undefined) {
			return res.status(400).json({
				message: "isSmartCollection is required",
			});
		}

		// 使用 Modules.PRODUCT 獲取產品模塊實例
		const productModule = req.scope.resolve(Modules.PRODUCT);

		try {
			// 首先獲取現有 collection
			const collection = await productModule.retrieveProductCollection(collectionId);

			// 準備更新 metadata（只更新 metadata 部分）
			const metadata = {
				...collection.metadata,
				isSmartCollection,
				smartCollectionConditions,
			};

			// 使用正確的參數格式更新 collection
			await productModule.updateProductCollections(collectionId, {
				metadata,
			});

			// 處理智能集合狀態變更
			const wasSmartCollection = collection.metadata?.isSmartCollection;

			if (!isSmartCollection && wasSmartCollection) {
				// 關閉智能集合時，移除所有商品
				// 獲取 collection 目前的所有產品
				const query = req.scope.resolve("query");
				const { data: collectionWithProducts } = await query.graph({
					entity: "product_collection",
					fields: ["products.id"],
					filters: { id: collectionId },
				});

				const firstCollection = collectionWithProducts?.[0];
				if (firstCollection?.products && firstCollection.products.length > 0) {
					const productIds = firstCollection.products.map((p: any) => p.id);

					// 移除所有產品
					await batchLinkProductsToCollectionWorkflow(req.scope).run({
						input: {
							id: collectionId,
							add: [],
							remove: productIds,
						},
					});
				}
			} else if (isSmartCollection && (!wasSmartCollection || smartCollectionConditions)) {
				// 啟用智能集合或更新規則時，執行同步
				await smartCollectionWorkflow(req.scope).run({
					input: {
						collection_id: collectionId,
					},
				});
			}

			// 返回設置保存成功
			return res.status(200).json({
				success: true,
				message: "Collection settings saved successfully",
			});
		} catch (error) {
			console.error("Error updating collection:", error);
			return res.status(500).json({
				message: "Failed to update collection",
				error: error.message,
			});
		}
	} catch (error) {
		console.error("Error handling smart collection settings:", error);
		return res.status(500).json({
			message: "An unexpected error occurred",
			error: error.message,
		});
	}
};
