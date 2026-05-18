import SmartCollectionService, { normalizeConditionExpression, normalizeRules, type Rule } from "../service";

const logger = {
	info: jest.fn(),
	debug: jest.fn(),
} as any;

describe("SmartCollectionService", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("normalizes rules by removing incomplete conditions", () => {
		const rules = normalizeRules([
			{ field: "title", operator: "contains", value: " Shirt " },
			{ field: "title", operator: "starts_with", value: "" },
			{ field: "handle", operator: "equals", value: "   " },
		] as Rule[]);

		expect(rules).toEqual([{ field: "title", operator: "contains", value: "Shirt" }]);
	});

	it("does not match empty condition values", () => {
		const service = new SmartCollectionService({ logger });

		expect(
			service.evaluateCondition(
				{ id: "prod_1", title: "Black Shirt" },
				{ field: "title", operator: "contains", value: "" },
			),
		).toBe(false);
	});

	it("evaluates multiple product fields", () => {
		const service = new SmartCollectionService({ logger });

		expect(
			service.evaluateCondition(
				{ id: "prod_1", title: "Black Shirt", handle: "black-shirt", description: "Cotton tee" },
				{ field: "handle", operator: "equals", value: "black-shirt" },
			),
		).toBe(true);
		expect(
			service.evaluateCondition(
				{ id: "prod_1", title: "Black Shirt", handle: "black-shirt", description: "Cotton tee" },
				{ field: "description", operator: "contains", value: "cotton" },
			),
		).toBe(true);
	});

	it("normalizes expression trees by dropping invalid branches", () => {
		const expression = normalizeConditionExpression({
			expression: {
				kind: "group",
				operator: "any",
				children: [
					{ kind: "rule", rule: { field: "title", operator: "contains", value: "" } },
					{ kind: "rule", rule: { field: "title", operator: "contains", value: "shirt" } },
				],
			},
		});

		expect(expression).toEqual({
			kind: "group",
			operator: "any",
			children: [{ kind: "rule", rule: { field: "title", operator: "contains", value: "shirt" } }],
		});
	});

	it("evaluates nested groups with mixed AND / OR operators", () => {
		const service = new SmartCollectionService({ logger });
		const product = {
			id: "prod_1",
			title: "Black Shirt",
			handle: "black-shirt",
			description: "Cotton tee",
		};

		// (title contains "pants" AND handle contains "black")
		//   OR
		// (title contains "shirt" AND (description contains "linen" OR handle equals "black-shirt"))
		const expression = normalizeConditionExpression({
			expression: {
				kind: "group",
				operator: "any",
				children: [
					{
						kind: "group",
						operator: "all",
						children: [
							{ kind: "rule", rule: { field: "title", operator: "contains", value: "pants" } },
							{ kind: "rule", rule: { field: "handle", operator: "contains", value: "black" } },
						],
					},
					{
						kind: "group",
						operator: "all",
						children: [
							{ kind: "rule", rule: { field: "title", operator: "contains", value: "shirt" } },
							{
								kind: "group",
								operator: "any",
								children: [
									{ kind: "rule", rule: { field: "description", operator: "contains", value: "linen" } },
									{ kind: "rule", rule: { field: "handle", operator: "equals", value: "black-shirt" } },
								],
							},
						],
					},
				],
			},
		});

		expect(expression).not.toBeNull();
		expect(service.evaluateConditions(product, { expression })).toBe(true);
	});

	it("migrates legacy per-child connector data on read", () => {
		const service = new SmartCollectionService({ logger });
		const product = { id: "prod_1", title: "Black Shirt" };

		// Legacy shape: child connector "any" → should be lifted to group.operator = "any".
		const expression = normalizeConditionExpression({
			expression: {
				kind: "group",
				children: [
					{ kind: "rule", rule: { field: "title", operator: "contains", value: "pants" } },
					{ kind: "rule", connector: "any", rule: { field: "title", operator: "contains", value: "shirt" } },
				],
			} as any,
		});

		expect(expression).toEqual({
			kind: "group",
			operator: "any",
			children: [
				{ kind: "rule", rule: { field: "title", operator: "contains", value: "pants" } },
				{ kind: "rule", rule: { field: "title", operator: "contains", value: "shirt" } },
			],
		});

		expect(service.evaluateConditions(product, { expression })).toBe(true);
	});
});
