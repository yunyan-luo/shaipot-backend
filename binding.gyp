{
  "targets": [
    {
      "target_name": "addon",
      "sources": [ "native-addon/addon.cpp" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "OTHER_LDFLAGS": [
              "-L/opt/homebrew/opt/openssl@3/lib",
              "-L/usr/local/opt/openssl@3/lib",
              "-lssl",
              "-lcrypto"
            ],
            "OTHER_CFLAGS": [
              "-I/opt/homebrew/opt/openssl@3/include",
              "-I/usr/local/opt/openssl@3/include"
            ]
          }
        }],
        ["OS=='linux'", {
          "libraries": [
            "-lssl",
            "-lcrypto"
          ]
        }]
      ]
    }
  ]
}
