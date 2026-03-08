import { describe, expect, test } from "bun:test";
import { HandleStore } from "../src/handles.ts";

describe("HandleStore", () => {
	test("create returns sequential IDs", () => {
		const store = new HandleStore();
		const id1 = store.create("result_set", [{ id: "a" }, { id: "b" }]);
		const id2 = store.create("result_set", [{ id: "c" }]);
		expect(id1).toBe("result_set_1");
		expect(id2).toBe("result_set_2");
	});

	test("create with different types", () => {
		const store = new HandleStore();
		const r = store.create("result_set", [1, 2]);
		const s = store.create("state", [{ cart: [] }]);
		expect(r).toBe("result_set_1");
		expect(s).toBe("state_2");
	});

	test("resolve with position (1-indexed)", () => {
		const store = new HandleStore();
		const id = store.create("result_set", ["a", "b", "c"]);
		expect(store.resolve(id, 1)).toBe("a");
		expect(store.resolve(id, 2)).toBe("b");
		expect(store.resolve(id, 3)).toBe("c");
	});

	test("resolve without position returns full data", () => {
		const store = new HandleStore();
		const id = store.create("result_set", [1, 2, 3]);
		expect(store.resolve(id)).toEqual([1, 2, 3]);
	});

	test("resolve out of bounds returns null", () => {
		const store = new HandleStore();
		const id = store.create("result_set", ["a"]);
		expect(store.resolve(id, 0)).toBeNull();
		expect(store.resolve(id, 2)).toBeNull();
		expect(store.resolve(id, -1)).toBeNull();
	});

	test("resolve unknown handle returns null", () => {
		const store = new HandleStore();
		expect(store.resolve("nonexistent")).toBeNull();
		expect(store.resolve("nonexistent", 1)).toBeNull();
	});

	test("get returns full entry with meta", () => {
		const store = new HandleStore();
		const id = store.create("result_set", [1, 2], {
			description: "shoes",
		});
		const entry = store.get(id);
		expect(entry?.type).toBe("result_set");
		expect(entry?.data).toEqual([1, 2]);
		expect(entry?.meta?.["description"]).toBe("shoes");
	});

	test("list returns all handle IDs", () => {
		const store = new HandleStore();
		store.create("result_set", [1]);
		store.create("resource", [2]);
		expect(store.list()).toEqual(["result_set_1", "resource_2"]);
	});

	test("listByType filters correctly", () => {
		const store = new HandleStore();
		store.create("result_set", [1]);
		store.create("resource", [2]);
		store.create("result_set", [3]);
		expect(store.listByType("result_set")).toEqual([
			"result_set_1",
			"result_set_3",
		]);
		expect(store.listByType("resource")).toEqual(["resource_2"]);
	});

	test("format ids_only", () => {
		const store = new HandleStore();
		const id = store.create("result_set", [
			{ id: "SKU-1", name: "Shoe" },
			{ id: "SKU-2", name: "Hat" },
		]);
		const formatted = store.format(id, "ids_only");
		expect(formatted).toContain("1. SKU-1");
		expect(formatted).toContain("2. SKU-2");
	});

	test("format compact", () => {
		const store = new HandleStore();
		const id = store.create("result_set", [{ id: "SKU-1", name: "Red Shoe" }]);
		const formatted = store.format(id, "compact");
		expect(formatted).toContain("Red Shoe");
		expect(formatted).toContain("SKU-1");
	});

	test("format full", () => {
		const store = new HandleStore();
		const id = store.create("result_set", [{ id: "SKU-1", price: 99 }]);
		const formatted = store.format(id, "full");
		expect(formatted).toContain('"id":"SKU-1"');
		expect(formatted).toContain('"price":99');
	});

	test("format unknown handle", () => {
		const store = new HandleStore();
		expect(store.format("nope", "full")).toContain("not found");
	});

	test("stateReminder with active handles", () => {
		const store = new HandleStore();
		store.create("result_set", [1, 2], {
			description: "running shoes search",
		});
		store.create("result_set", [3], { description: "hat search" });
		const reminder = store.stateReminder();
		expect(reminder).toContain("result_set_1");
		expect(reminder).toContain("running shoes search");
		expect(reminder).toContain("result_set_2");
		expect(reminder).toContain("hat search");
	});

	test("stateReminder empty returns empty string", () => {
		const store = new HandleStore();
		expect(store.stateReminder()).toBe("");
	});

	test("remove deletes a handle", () => {
		const store = new HandleStore();
		const id = store.create("result_set", [1]);
		expect(store.remove(id)).toBe(true);
		expect(store.resolve(id)).toBeNull();
		expect(store.list()).toEqual([]);
	});

	test("clear resets everything", () => {
		const store = new HandleStore();
		store.create("result_set", [1]);
		store.create("result_set", [2]);
		store.clear();
		expect(store.list()).toEqual([]);
		// Counter also resets
		const id = store.create("result_set", [3]);
		expect(id).toBe("result_set_1");
	});

	test("activeHandleIds matches list", () => {
		const store = new HandleStore();
		store.create("result_set", [1]);
		store.create("state", [2]);
		expect(store.activeHandleIds()).toEqual(store.list());
	});
});
