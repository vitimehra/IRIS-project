"""
Consent shown once after a participant's first login. Edit freely; bump the
version when you do - it is stored against each participant's consent.
"""

CONSENT_VERSION = "1.0.0"

CONSENT = {
    "title": "Before you begin",
    "sections": [
        {
            "heading": "What this study is",
            "body": "You will describe a small everyday difficulty in your own words. The system will help structure it into a design problem, and then you will generate ideas for solving it three ways: on your own, with an AI assistant, and with an AI assistant that draws inspiration from a knowledge graph of world phenomena. At the end you will rate all the ideas, concepts and product renderings without being told which method produced which. It takes about 60 to 90 minutes.",
        },
        {
            "heading": "What is recorded",
            "body": "Everything you type or say, every response the AI produces for you, the images it generates, your ratings, and how long each step takes. It is stored under your participant code, not your name. Your name, age and background were recorded by the researcher when your code was created and are kept separately.",
        },
        {
            "heading": "How the AI is used",
            "body": "Your text is sent to Anthropic's Claude to structure it and generate ideas and concepts, and to OpenAI to produce product images. Claude may perform web searches to find real-world phenomena. Nothing identifying you is included in what is sent.",
        },
        {
            "heading": "Voluntary",
            "body": "You can stop at any time by closing the tab. You can ask the researchers to delete everything recorded under your code.",
        },
    ],
    "items": [
        {"key": "understood", "text": "I have read the above and understand what the study involves."},
        {"key": "recording", "text": "I agree that my inputs, the AI's outputs, the generated images and my ratings may be stored and analysed for this research."},
        {"key": "ai", "text": "I understand that my text will be processed by AI services (Anthropic, OpenAI)."},
        {"key": "publication", "text": "I agree that anonymised findings may be published."},
    ],
    "contacts": "Viti Mehra · Sankar Balasubramanian",
}
