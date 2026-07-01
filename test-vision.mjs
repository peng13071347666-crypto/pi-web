import { complete } from '@earendil-works/pi-ai/compat';
import { readFileSync } from 'fs';
import { join } from 'path';

const homedir = process.env.USERPROFILE;
const modelsPath = join(homedir, '.pi', 'agent', 'models.json');
const models = JSON.parse(readFileSync(modelsPath, 'utf8'));

const providerConfig = models.providers['小米公益站'];
const modelConfig = providerConfig.models.find(m => m.id === 'mimo-v2.5');
const visionModel = {
  id: 'mimo-v2.5',
  provider: '小米公益站',
  api: modelConfig.api || providerConfig.api || 'openai-completions',
  baseUrl: providerConfig.baseUrl,
  input: modelConfig.input || ['text'],
  name: modelConfig.name || modelConfig.id,
};

console.log('Model:', JSON.stringify(visionModel, null, 2));

const testImage = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==';

async function test() {
  try {
    const response = await complete(visionModel, {
      systemPrompt: 'You are a precise image analysis assistant.',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image briefly.' },
          { type: 'image', data: testImage, mimeType: 'image/png' }
        ],
        timestamp: Date.now()
      }]
    }, {
      apiKey: providerConfig.apiKey
    });
    
    console.log('SUCCESS');
    console.log('stopReason:', response.stopReason);
    const text = response.content.filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    console.log('text:', text);
  } catch(e) {
    console.error('ERROR:', e.message);
    console.error('Stack:', e.stack?.substring(0, 500));
  }
}

test();
