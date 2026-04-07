const upwork = require("./upwork");
const seek = require("./seek");

const providers = {
  upwork,
  seek
};

function getProvider(providerId) {
  const provider = providers[providerId];
  if (!provider) {
    throw new Error(`Unsupported provider: ${providerId}`);
  }
  return provider;
}

function listProviders() {
  return Object.values(providers).map((provider) => ({
    id: provider.id,
    name: provider.name,
    capabilities: provider.capabilities
  }));
}

module.exports = {
  providers,
  getProvider,
  listProviders
};
