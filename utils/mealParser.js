// utils/mealParser.js

// Parse meal sections from AI response
function parseMealSections(mealInfo) {
    const foodSections = [];
    
    // First, try to split by multiple "🍽️ Plato:" sections
    if (mealInfo.includes("🍽️ Plato:") && mealInfo.split("🍽️ Plato:").length > 2) {
      // Multiple "Plato" sections found
      const sections = mealInfo.split("🍽️ Plato:");
      // Skip the first empty element
      for (let i = 1; i < sections.length; i++) {
        if (sections[i].trim()) {
          foodSections.push("🍽️ Plato:" + sections[i]);
        }
      }
    } 
    // If no multiple sections found, check if there are numbered items
    else if (mealInfo.match(/\d+\.\s+/)) {
      // Split by numbered items (1., 2., etc.)
      const lines = mealInfo.split('\n');
      let currentSection = "";
      let inSection = false;
      
      for (const line of lines) {
        // If line starts with a number followed by a dot, it's a new section
        if (line.match(/^\d+\.\s+/)) {
          if (inSection && currentSection.trim()) {
            foodSections.push(currentSection.trim());
          }
          currentSection = line + '\n';
          inSection = true;
        } else if (inSection) {
          currentSection += line + '\n';
        }
      }
      
      // Add the last section
      if (inSection && currentSection.trim()) {
        foodSections.push(currentSection.trim());
      }
    } 
    // If no structured format is found, treat the whole response as one item
    else {
      foodSections.push(mealInfo);
    }
    
    return foodSections;
  }
  
  // Extract meal data from a section
  function extractMealData(section) {
    // Extract description (the dish name)
    let description = "";
    
    // Try to match with the "🍽️ Plato:" prefix first
    const descriptionMatch = section.match(/🍽️ Plato: (.*?)(\n|$)/);
    if (descriptionMatch) {
      description = descriptionMatch[1].trim();
    } else {
      // If no match, try to get the first line of the section as the dish name
      const firstLineMatch = section.split('\n')[0];
      if (firstLineMatch) {
        // Remove any emoji, numbers, or prefix if present
        description = firstLineMatch.replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]*/, '').trim();
        // Remove any trailing punctuation
        description = description.replace(/[.:,;]$/, '').trim();
      }
    }
  
    // Extract nutritional values for this section
    const kcalMatch = section.match(/Calorías: ([\d.]+) kcal/);
    const proteinMatch = section.match(/Proteínas: ([\d.]+)g/);
    const carbsMatch = section.match(/Carbohidratos: ([\d.]+)g/);
    const fatMatch = section.match(/Grasas: ([\d.]+)g/);
  
    return {
      description,
      kcal: kcalMatch ? kcalMatch[1] : "",
      protein: proteinMatch ? proteinMatch[1] : "",
      carbohydrates: carbsMatch ? carbsMatch[1] : "",
      fat: fatMatch ? fatMatch[1] : ""
    };
  }
  
  module.exports = {
    parseMealSections,
    extractMealData
  };