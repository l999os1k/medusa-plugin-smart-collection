import { Module } from "@medusajs/framework/utils";
import SmartCollectionService from "./service";

export const SMART_COLLECTION_MODULE = "smart_collection";

export default Module(SMART_COLLECTION_MODULE, {
	service: SmartCollectionService,
});
