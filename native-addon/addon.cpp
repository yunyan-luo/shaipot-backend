#include <napi.h>
#include <random>
#include <string>
#include <sstream>
#include <iostream>

#include <stdint.h>
#include <iostream>
#include <string>
#include <sstream>
#include <cstring>
#include <iomanip>
#include <cstdint>
#include <algorithm>

void hexStringToBytes(const std::string& hexStr, unsigned char* bytes) {
    for (size_t i = 0; i < 32; i++) {
        unsigned int byte;
        std::stringstream ss;
        ss << std::hex << hexStr.substr(i * 2, 2);
        ss >> byte;
        bytes[i] = static_cast<unsigned char>(byte);
    }
}

uint64_t ReadLE64(const unsigned char* ptr) {
    uint64_t x;
    std::memcpy(&x, ptr, sizeof(uint64_t));
    return x;
}

uint64_t extract_seed_from_hash(const std::string& hash_str) {
    unsigned char hash_bytes[32];
    hexStringToBytes(hash_str, hash_bytes);
    std::reverse(hash_bytes, hash_bytes + 32);
    return ReadLE64(hash_bytes);
}

Napi::Array graphToNapiArray(const std::vector<std::vector<bool>>& graph, Napi::Env env) {
    size_t gridSize = graph.size();
    Napi::Array result = Napi::Array::New(env, gridSize);
    for (size_t i = 0; i < gridSize; ++i) {
        Napi::Array row = Napi::Array::New(env, gridSize);
        for (size_t j = 0; j < gridSize; ++j) {
            row[j] = Napi::Boolean::New(env, graph[i][j]);
        }
        result[i] = row;
    }
    return result;
}

std::vector<std::vector<bool>> initializeGraph(size_t gridSize) {
    return std::vector<std::vector<bool>>(gridSize, std::vector<bool>(gridSize, false));
}

Napi::Value GenerateGraph(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    std::string hash = info[0].As<Napi::String>().Utf8Value();
    size_t gridSize = info[1].As<Napi::Number>().Int32Value();

    uint64_t seed = extract_seed_from_hash(hash);
    std::mt19937_64 prng(seed);

    auto graph = initializeGraph(gridSize);
    size_t numEdges = (gridSize * (gridSize - 1)) / 2;
    size_t bitsNeeded = numEdges;
    std::vector<bool> bitStream;
    bitStream.reserve(bitsNeeded);

    for (size_t i = 0; i < bitsNeeded; ++i) {
        uint32_t randomBits = prng();
        for (int j = 31; j >= 0 && bitStream.size() < bitsNeeded; --j) {
            bool bit = (randomBits >> j) & 1;
            bitStream.push_back(bit);
        }
    }

    size_t bitIndex = 0;
    for (size_t i = 0; i < gridSize; ++i) {
        for (size_t j = i + 1; j < gridSize; ++j) {
            bool edgeExists = bitStream[bitIndex++];
            graph[i][j] = graph[j][i] = edgeExists;
        }
    }

    return graphToNapiArray(graph, env);
}

Napi::Value GenerateGraphV2(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    std::string hash = info[0].As<Napi::String>().Utf8Value();
    size_t gridSize = info[1].As<Napi::Number>().Int32Value();
    uint16_t percentageX10 = info[2].As<Napi::Number>().Int32Value();

    uint64_t seed = extract_seed_from_hash(hash);
    
    bool debug = (std::getenv("SHARE_DEBUG") != nullptr);
    
    if (debug) {
        std::cout << "CPP SEED DEBUG: hash=" << hash << ", extracted_seed=" << seed << std::endl;
    }
    
    std::mt19937_64 prng;
    prng.seed(seed);

    auto graph = initializeGraph(gridSize);
    
    const uint64_t range = 1000;
    const uint64_t threshold = (percentageX10 * range) / 1000;
    
    if (debug) {
        std::cout << "CPP GRAPH DEBUG: gridSize=" << gridSize << ", percentageX10=" << percentageX10 << ", threshold=" << threshold << std::endl;
    }
    
    std::uniform_int_distribution<uint64_t> distribution(0, range-1);

    for (size_t i = 0; i < gridSize; ++i) {
        for (size_t j = i + 1; j < gridSize; ++j) {
            uint64_t randomValue = distribution(prng);
            bool edgeExists = randomValue < threshold;
            
            if (debug && i < 10 && j < 10) {
                std::cout << "CPP GRAPH DEBUG: Edge [" << i << "][" << j << "] randomValue=" << randomValue << " threshold=" << threshold << " edgeExists=" << edgeExists << std::endl;
            }
            
            graph[i][j] = graph[j][i] = edgeExists;
        }
    }

    return graphToNapiArray(graph, env);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "generateGraph"), Napi::Function::New(env, GenerateGraph));
    exports.Set(Napi::String::New(env, "generateGraphV2"), Napi::Function::New(env, GenerateGraphV2));
    return exports;
}

NODE_API_MODULE(addon, Init)
