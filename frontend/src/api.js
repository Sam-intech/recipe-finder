// Every call to the FastAPI backend goes through here, so components never deal with fetch.

async function request(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.detail || "Something went wrong. Try again.");
    error.status = response.status;  // 429 means the AI is tired.
    throw error;
  }
  return response;
}

const json = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function searchRecipes(query) {
  const response = await request("/api/recipes?q=" + encodeURIComponent(query));
  return (await response.json()).results;
}

export async function generateRecipe(query) {
  const response = await request("/api/recipes/generate", json({ q: query }));
  return (await response.json()).recipe;
}

function listBody(recipe, have) {
  return { recipe_name: recipe.name, ingredients: recipe.ingredients, have };
}

export async function buildShoppingList(recipe, have) {
  const response = await request("/api/shopping-list", json(listBody(recipe, have)));
  return (await response.json()).items;
}

export async function downloadList(recipe, have, format) {
  const response = await request(
    "/api/shopping-list/export?format=" + format, json(listBody(recipe, have)));
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "shopping-list." + format;
  anchor.click();
  URL.revokeObjectURL(url);
}
