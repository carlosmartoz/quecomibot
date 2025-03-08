class NutritionParser {
  static parse(response) {
    if (response.includes("¡Oops!")) {
      throw new Error("Invalid input response");
    }

    const nutritionInfo = {
      description: "",
      kcal: null,
      protein: null,
      fat: null,
      carbohydrates: null,
    };

    const foodMatch = response.match(/🍽️\s*Plato:\s*([^\n]+)/i) || 
                     response.match(/🥣\s*Plato:\s*([^\n]+)/i) ||
                     response.match(/🍔\s*Plato:\s*([^\n]+)/i);
    if (!foodMatch) throw new Error("Missing food name");
    nutritionInfo.description = foodMatch[1].trim();

    const kcalMatch = response.match(/Calorías:\s*(\d+)\s*kcal/i);
    if (!kcalMatch) throw new Error("Missing calories information");
    nutritionInfo.kcal = parseInt(kcalMatch[1]);

    const proteinMatch = response.match(/Proteínas:\s*(\d+(?:\.\d+)?)\s*g/i);
    if (!proteinMatch) throw new Error("Missing protein information");
    nutritionInfo.protein = parseFloat(proteinMatch[1]);

    const fatMatch = response.match(/Grasas:\s*(\d+(?:\.\d+)?)\s*g/i);
    if (!fatMatch) throw new Error("Missing fat information");
    nutritionInfo.fat = parseFloat(fatMatch[1]);

    const carbsMatch = response.match(/Carbohidratos:\s*(\d+(?:\.\d+)?)\s*g/i);
    if (!carbsMatch) throw new Error("Missing carbohydrates information");
    nutritionInfo.carbohydrates = parseFloat(carbsMatch[1]);

    if (isNaN(nutritionInfo.kcal) || 
        isNaN(nutritionInfo.protein) || 
        isNaN(nutritionInfo.fat) || 
        isNaN(nutritionInfo.carbohydrates)) {
      throw new Error("Invalid numerical values");
    }

    return nutritionInfo;
  }
}

module.exports = NutritionParser; 