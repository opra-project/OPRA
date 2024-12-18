/**
 * Converts a string to snake_case without punctuation.
 */
export function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function generateSlug(str: string): string {
  return str
    .toLowerCase()
    .replace(/[\s\-()]+/g, "_")
    .replace(/[^\w_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Splits a product name into vendor and product components using GPT-4.
 */
export async function splitVendorModel(productName: string): Promise<{ vendorName: string; productName: string }> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  
  if (!apiKey) {
    throw new Error("OpenAI API key not found in environment.");
  }

  let retries = 10;
  let temp = 0.2;

  while (retries > 0) {
    try {
      const prompt = `Extract the vendor name and product name from the following product name: "${productName}". The vendor name is the part of the string that comes before the specific model or product designation. 

When you see a product name like 'Sennheiser HD 800 S', split it so that vendor is 'Sennheiser' and product name is 'HD 800 S'
When you see a product name like 'Moondrop x Crinacle FooBarBaz', split it so that vendor is 'Moondrop' and product name is 'Moondrop x Crinacle FooBarBaz'. This is a special case for collaborations
In general, words like "Audio" or "Acoustics" are part of a vendor name, e.g. "Aroma Audio ACE" is a product by "Aroma Audio". "ACE" is the product name. "Audio" is not part of the product name.
There is a vendor called "Unknown". 

Your response should in the format { "vendorName": "Vendor Name", "productName": "Product Name" }.`;

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: prompt }
          ],
          max_tokens: 100,
          temperature: temp,
        }),
      });

      const data = await response.json();
      const json = JSON.parse(data.choices?.[0]?.message?.content.trim());

      if (json && json.vendorName && json.productName) {
        return json;
      } else {
        console.error(`Failed to extract vendor and product names: ${data}`);
        retries--;
        await sleep(5);
        temp += 0.05;
      }
    } catch (error) {
      console.error(`Failed to extract vendor and product names: ${error}`);
      retries--;
      temp += 0.05;
      await sleep(5);
      continue;
    }
  }
  throw new Error(`Failed to split vendor/model after ${10 - retries} attempts`);
}
