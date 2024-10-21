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

Napi::Value GenerateGraph(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    std::string hash = info[0].As<Napi::String>().Utf8Value();
    size_t gridSize = info[1].As<Napi::Number>().Int32Value();

    uint64_t seed = extract_seed_from_hash(hash);
    
    std::mt19937_64 prng(seed);

    std::vector<std::vector<bool>> graph(gridSize, std::vector<bool>(gridSize, false));
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

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "generateGraph"), Napi::Function::New(env, GenerateGraph));
    return exports;
}

NODE_API_MODULE(addon, Init)
